import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { activarSolicitud, terminarImpersonacion } from './solicitudes-actions'
import { pasarAPago } from './[slug]/actions'

/**
 * El circuito de venta del proveedor, de punta a punta y DE VERDAD:
 * el cliente pide -> Control activa (en prueba o de pago) -> la prueba se
 * pasa a pago -> la instalacion queda pendiente para la factura.
 *
 * Antes solo existia "Activar en prueba": no habia forma de pasar una
 * prueba a pago desde la pantalla, y al vencer los 14 dias el modulo se
 * apagaba sin cobrarse. El aviso al cliente, ademas, le hablaba en
 * identificadores ("ar, sales-orders").
 */

const PROVEEDOR = '00000000-0000-0000-0000-00000000f00d'
let c: ClientePrueba

async function solicitud(modulos: string[]): Promise<string> {
  const [r] = await db()<{ id: string }[]>`
    insert into regb.activation_requests (tenant_id, modules, quoted_monthly, quoted_install)
    values (${c.tenantId}, ${modulos}, 44.84, 300)
    returning id`
  return r!.id
}

const modulo = async (id: string) =>
  (
    await db()<{ status: string; trial_ends_at: string | null }[]>`
      select status::text, trial_ends_at::text from regb.tenant_modules
      where tenant_id = ${c.tenantId} and module_id = ${id}`
  )[0]

const pendiente = async (id: string) =>
  (
    await db()<{ amount: string | null }[]>`
      select amount::text from regb.module_installation_charges
      where tenant_id = ${c.tenantId} and module_id = ${id}`
  )[0]

const ultimoAviso = async () =>
  (
    await db()<{ body: string }[]>`
      select body from public.notifications where tenant_id = ${c.tenantId}
      order by created_at desc limit 1`
  )[0]?.body

/** El aviso que dejo la ultima accion, y lo borra para la siguiente. */
function avisoProveedor(): { tipo: string; texto: string } | null {
  const g = tarro.get(COOKIE_AVISO)
  tarro.delete(COOKIE_AVISO)
  return g ? (JSON.parse(g.value) as { tipo: string; texto: string }) : null
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-venta',
    modulos: ['pos'],
    roles: { Owner: { '*': true } },
  })
})

afterAll(async () => {
  await db()`delete from regb.impersonation_log where tenant_id = ${c.tenantId}`
  await c.limpiar([
    'regb.module_installation_charges',
    'public.notifications',
    'regb.activation_requests',
  ])
  await cerrarBase()
})

describe('activarSolicitud', () => {
  it('en prueba: 14 dias, sin cargo de instalacion, y el aviso nombra los modulos', async () => {
    const id = await solicitud(['ar', 'sales-orders'])
    const fd = new FormData()
    fd.set('id', id)
    fd.set('modo', 'prueba')
    await activarSolicitud(fd)

    expect((await modulo('ar'))?.status).toBe('trial')
    expect((await modulo('ar'))?.trial_ends_at).not.toBeNull()
    expect(await pendiente('ar')).toBeUndefined()

    const body = await ultimoAviso()
    expect(body).toContain('Cuentas por cobrar')
    expect(body).toContain('Pedidos de venta')
    expect(body).not.toMatch(/\bar\b|sales-orders/)
    expect(avisoProveedor()?.tipo).toBe('ok')
  })

  it('atender dos veces la misma solicitud no hace nada y lo dice', async () => {
    const [r] = await db()<{ id: string }[]>`
      select id from regb.activation_requests
      where tenant_id = ${c.tenantId} and status = 'activated' limit 1`
    const fd = new FormData()
    fd.set('id', r!.id)
    fd.set('modo', 'pago')
    await activarSolicitud(fd)
    expect((await modulo('ar'))?.status).toBe('trial')
    expect(avisoProveedor()?.tipo).toBe('error')
  })

  it('de pago: queda activo y la instalacion pendiente para la proxima factura', async () => {
    const id = await solicitud(['crm'])
    const fd = new FormData()
    fd.set('id', id)
    fd.set('modo', 'pago')
    await activarSolicitud(fd)

    expect(await modulo('crm')).toEqual({ status: 'active', trial_ends_at: null })
    expect(await pendiente('crm')).toEqual({ amount: null })
    expect(await ultimoAviso()).toContain('próxima factura')
  })
})

describe('pasarAPago', () => {
  it('pasa la prueba a pago junto con lo que necesita, y deja la instalacion pendiente', async () => {
    const fd = new FormData()
    fd.set('slug', c.slug)
    fd.set('moduleId', 'ar')
    await pasarAPago(fd)

    // Cuentas por cobrar requiere Pedidos de venta: pasar solo una apagaria
    // la otra a los 14 dias.
    expect((await modulo('ar'))?.status).toBe('active')
    expect((await modulo('sales-orders'))?.status).toBe('active')
    expect(await pendiente('ar')).toEqual({ amount: null })
    expect(await pendiente('sales-orders')).toEqual({ amount: null })
    expect(avisoProveedor()?.texto).toContain('Cuentas por cobrar')
  })

  it('sobre un modulo que ya es de pago no cambia nada y lo dice', async () => {
    const fd = new FormData()
    fd.set('slug', c.slug)
    fd.set('moduleId', 'pos')
    await pasarAPago(fd)
    expect(avisoProveedor()?.tipo).toBe('error')
    expect((await modulo('pos'))?.status).toBe('active')
  })

  it('tambien una prueba que ya vencio (la venta que se iba a perder)', async () => {
    await db()`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled, trial_ends_at)
      values (${c.tenantId}, 'quotes', 'trial', true, current_date - 3)`
    const fd = new FormData()
    fd.set('slug', c.slug)
    fd.set('moduleId', 'quotes')
    await pasarAPago(fd)
    expect(await modulo('quotes')).toEqual({ status: 'active', trial_ends_at: null })
  })
})

describe('terminarImpersonacion', () => {
  it('cierra de verdad la sesion abierta del proveedor', async () => {
    await db()`select regb.start_impersonation(
      ${PROVEEDOR}, ${c.tenantId}, 'Soporte: revisar la prueba del cliente', null)`
    await terminarImpersonacion()
    const abiertas = await db()`
      select 1 from regb.impersonation_log
      where provider_user = ${PROVEEDOR} and ended_at is null`
    expect(abiertas).toHaveLength(0)
  })
})
