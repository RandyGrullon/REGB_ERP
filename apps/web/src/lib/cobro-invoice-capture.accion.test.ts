import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { solicitarActivacion } from '@/app/marketplace/actions'
import { loadTenantsWithModules, quoteTenant } from './control'

/**
 * Nadie paga por `invoice-capture` mientras no exista (0124).
 *
 * Llama al motor de verdad: `loadTenantsWithModules()` es lo unico que
 * alimenta a `calculateMonthly` tanto en REGB Control como en
 * `generateMonthlyInvoices()`. Si un modulo no sale de ahi, no se cobra
 * ni se factura. Y la accion real del marketplace, para fijar que un
 * cliente tampoco puede pedirlo.
 *
 * supabase/tests/invoice-capture.test.ts fija la guarda de la base.
 */

let c: ClientePrueba

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-invcap',
    nombre: 'Colmado Los Hermanos SRL',
    modulos: ['inventory', 'ap'],
    roles: { Owner: { '*': true } },
  })
})

afterAll(async () => {
  await c.limpiar()
  await cerrarBase()
})

describe('Motor de facturacion', () => {
  it('ningun cliente lleva invoice-capture en lo que se cobra', async () => {
    const { tenants, modulesByTenant } = await loadTenantsWithModules()
    const cobrados = tenants.flatMap((t) =>
      (modulesByTenant.get(t.id) ?? [])
        .filter((m) => m.module_id === 'invoice-capture')
        .map(() => t.slug),
    )
    // Antes de 0124: ['distribuidora-caribe'], y US$160 al mes en su cuota.
    expect(cobrados).toEqual([])
  })

  it('aunque alguien intente activarlo, la cotizacion no cambia', async () => {
    const antes = await loadTenantsWithModules(c.slug)
    const tenant = antes.tenants[0]!
    const cuotaAntes = quoteTenant(tenant, antes.modulesByTenant.get(tenant.id) ?? [])

    await expect(db()`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${c.tenantId}, 'invoice-capture', 'active', true)`).rejects.toThrow(
      /todavia no existe/,
    )

    const despues = await loadTenantsWithModules(c.slug)
    const cuota = quoteTenant(tenant, despues.modulesByTenant.get(tenant.id) ?? [])
    expect(cuota.monthly.total).toBe(cuotaAntes.monthly.total)
    expect(cuota.installation.total).toBe(cuotaAntes.installation.total)
    // pyme: 79 de base + inventory y ap (standard, 19 cada uno) = 117,
    // + ITBIS 18 % porque el cliente es de RD (0128) = 138.06.
    expect(cuota.monthly.total).toBe(138.06)
  })
})

describe('Marketplace', () => {
  it('un cliente no puede pedirlo', async () => {
    const r = await solicitarActivacion(
      c.fd({ modulos: JSON.stringify(['invoice-capture']), mensual: '45', instalacion: '400' }),
    )
    expect(r).toEqual({ ok: false, error: 'Ninguno de esos modulos esta disponible todavia.' })

    const [n] = await db()<{ n: string }[]>`
      select count(*)::text as n from regb.activation_requests where tenant_id = ${c.tenantId}`
    expect(Number(n!.n)).toBe(0)
  })
})
