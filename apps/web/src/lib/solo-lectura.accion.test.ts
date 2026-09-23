import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, db } from '@/lib/db'
import { COOKIE_AVISO } from '@/lib/aviso-comun'
import { cerrarBase, sembrarCliente, tarro, type ClientePrueba } from '@/test/arnes'
import { marcarTodasLeidas } from '@/app/notificaciones/actions'
import { actionCtx, exigir, MENSAJE_SOLO_LECTURA } from './module-page'

/**
 * "Solo lectura" por mora, llamando acciones DE VERDAD (0128).
 *
 * Antes era un cartel rojo: `checkAccess` no miraba `readonly` y el
 * cliente seguia registrando ventas, compras y todo lo demas. Ahora
 * `exigir()` -la puerta por la que pasa toda accion- niega lo que escribe
 * y deja ver y exportar. La parte de PostgREST esta en
 * supabase/tests/cobro-regb.test.ts.
 */

const DEMO = '00000000-0000-0000-0000-000000000001'
let c: ClientePrueba

async function estado(s: string): Promise<void> {
  await db()`update regb.tenants set status = ${s}::regb.tenant_status where id = ${c.tenantId}`
}

async function sinLeer(): Promise<number> {
  const [r] = await asUser(
    DEMO,
    c.tenantId,
    (tx) => tx<{ n: number }[]>`
    select public.avisos_sin_leer() as n`,
  )
  return r!.n
}

function textoAviso(): string | null {
  const g = tarro.get(COOKIE_AVISO)
  return g ? (JSON.parse(g.value) as { texto: string }).texto : null
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-lectura',
    nombre: 'Ferreteria en Mora SRL',
    modulos: ['notifications', 'payroll', 'inventory', 'pos'],
    roles: { Gerente: { '*': true } },
  })
  await db()`
    insert into public.notifications (tenant_id, module_id, title)
    values (${c.tenantId}, 'pos', 'Falto efectivo en el cierre de caja')`
})

afterAll(async () => {
  await c.limpiar()
  await cerrarBase()
})

describe('En solo lectura', () => {
  it('una accion que escribe se niega, y dice por que', async () => {
    await estado('readonly')
    tarro.delete(COOKIE_AVISO)

    await marcarTodasLeidas(c.fd())

    expect(textoAviso()).toBe(MENSAJE_SOLO_LECTURA)
    expect(await sinLeer()).toBe(1)
  })

  it('ver y exportar siguen abiertos; crear, editar o borrar no', async () => {
    const ctx = await actionCtx({ tenant: c.slug, rol: 'Gerente' })
    expect(ctx?.tenantStatus).toBe('readonly')
    for (const leer of [
      'products.view',
      'products.export',
      'payroll.view.own',
      'inventory.cost.view',
    ]) {
      expect(exigir(ctx!, leer.split('.')[0]!, leer)).toEqual({ ok: true })
    }
    for (const escribir of ['products.create', 'pos.sell', 'notifications.edit', 'users.delete']) {
      expect(exigir(ctx!, escribir.split('.')[0]!, escribir)).toEqual({
        ok: false,
        error: MENSAJE_SOLO_LECTURA,
      })
    }
  })

  it('suspendido o archivado, tampoco (el modo demo no pasa por checkAccess)', async () => {
    for (const s of ['suspended', 'archived']) {
      await estado(s)
      const ctx = await actionCtx({ tenant: c.slug, rol: 'Gerente' })
      expect(exigir(ctx!, 'products', 'products.create').ok).toBe(false)
    }
  })
})

describe('Al dia o en mora temprana', () => {
  it('con el banner amarillo (past_due) se sigue trabajando', async () => {
    await estado('past_due')
    const ctx = await actionCtx({ tenant: c.slug, rol: 'Gerente' })
    expect(exigir(ctx!, 'products', 'products.create')).toEqual({ ok: true })
  })

  it('al pagar vuelve a active y la misma accion escribe', async () => {
    await estado('active')
    tarro.delete(COOKIE_AVISO)
    await marcarTodasLeidas(c.fd())
    expect(textoAviso()).toBe('Listo, marcamos todas como leidas.')
    expect(await sinLeer()).toBe(0)
  })
})
