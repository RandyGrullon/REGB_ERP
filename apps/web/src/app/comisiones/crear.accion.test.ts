import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { almacen, cliente, limpiarCredito, pedido, producto } from '@/test/venta-a-credito'
import { crearEntrada } from './actions'

/**
 * crearEntrada() llamada DE VERDAD (grabación de la demo, 15 oct 2026).
 *
 * "Nueva comisión" tomaba de base el total del pedido CON ITBIS, mientras
 * "Mis comisiones" rotula la columna "Vendido sin ITBIS" y la semilla
 * calcula sobre el subtotal. El ITBIS es de la DGII: comisionarlo le paga
 * al vendedor un 18% de más.
 */

/** El usuario del modo demostración (bootstrap.ts). */
const YO = '00000000-0000-0000-0000-000000000001'

let c: ClientePrueba
let orden: string
let porcentaje: string
let fijo: string

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-comisiones',
    modulos: ['products', 'inventory', 'sales-orders', 'commissions'],
    roles: { Dueno: { '*': true } },
  })
  const wh = await almacen(c.tenantId)
  const prod = await producto(c.tenantId, wh, { sku: 'PIN-300', precio: 1150 })
  const hotel = await cliente(c.tenantId, { nombre: 'Hotel Costa Azul SRL' })
  // 10 x 1,150 = 11,500 sin ITBIS; 13,570 con ITBIS.
  orden = await pedido(c.tenantId, {
    customerId: hotel,
    warehouseId: wh,
    productId: prod,
    cantidad: 10,
    precio: 1150,
    estado: 'confirmed',
  })
  const planes = await db()<{ id: string; basis: string }[]>`
    insert into public.commission_plans (tenant_id, name, basis, rate)
    values (${c.tenantId}, 'Plan de mostrador', 'percentage', 0.05),
           (${c.tenantId}, 'Bono por pedido', 'fixed', 1500)
    returning id, basis`
  porcentaje = planes.find((p) => p.basis === 'percentage')!.id
  fijo = planes.find((p) => p.basis === 'fixed')!.id
})

afterAll(async () => {
  await db()`delete from public.commission_entries where tenant_id = ${c.tenantId}`
  await db()`delete from public.commission_plans where tenant_id = ${c.tenantId}`
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

async function entrada(planId: string): Promise<{ base: string; comision: string } | undefined> {
  const [e] = await db()<{ base: string; comision: string }[]>`
    select base_amount::text as base, commission_amount::text as comision
    from public.commission_entries
    where tenant_id = ${c.tenantId} and plan_id = ${planId}`
  return e
}

describe('Nueva comisión', () => {
  it('el 5% se calcula sobre lo vendido sin ITBIS: 11,500 -> 575.00', async () => {
    const r = await crearEntrada(
      c.fd({ planId: porcentaje, salesOrderId: orden, salespersonId: YO }),
    )
    expect(r).toEqual({ ok: true })
    // Con el total (13,570) salía 678.50.
    expect(await entrada(porcentaje)).toEqual({ base: '11500.00', comision: '575.00' })
  })

  it('un plan fijo guarda la misma base sin ITBIS y paga la tasa tal cual', async () => {
    const r = await crearEntrada(c.fd({ planId: fijo, salesOrderId: orden, salespersonId: YO }))
    expect(r).toEqual({ ok: true })
    expect(await entrada(fijo)).toEqual({ base: '11500.00', comision: '1500.00' })
  })
})
