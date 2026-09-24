import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import {
  agregarLinea,
  crearTransferencia,
  despacharTransferencia,
  recibirTransferencia,
} from './actions'

/**
 * Transferencias con transito, con las acciones reales (hallazgos del
 * cliente misterioso, 23 sep):
 *
 *  - La mercancia entraba al destino a COSTO CERO: ni el despacho ni la
 *    recepcion ponian costo, y el kardex trata una entrada sin costo como
 *    "el promedio no cambia" -cero en un almacen sin ese producto-. Lo
 *    arregla la base (0137): la salida lleva el promedio del origen y la
 *    entrada el de su salida.
 *  - Se podia despachar lo que no habia (el origen quedaba en negativo) y
 *    recibir mas de lo que salio (existencia inventada en el destino).
 *  - Una linea en blanco al recibir se saltaba en silencio y la
 *    transferencia quedaba "recibida" con mercancia en ningun almacen.
 */

let c: ClientePrueba
let origen: string
let destino: string
let cemento: string
let servicio: string

async function existencia(
  almacen: string,
  producto = cemento,
): Promise<{ qty: number; avg: number }> {
  const [s] = await db()<{ qty: string; avg: string }[]>`
    select qty_on_hand::text as qty, avg_cost::text as avg from public.stock_levels
    where tenant_id = ${c.tenantId} and warehouse_id = ${almacen} and product_id = ${producto}`
  return { qty: Number(s?.qty ?? 0), avg: Number(s?.avg ?? 0) }
}

async function nuevaTransferencia(qty: string): Promise<string> {
  expect(
    await crearTransferencia(
      c.fd({ fromWarehouseId: origen, toWarehouseId: destino, notes: `prueba ${qty}` }),
    ),
  ).toEqual({ ok: true })
  const [o] = await db()<{ id: string }[]>`
    select id from public.transfer_orders where tenant_id = ${c.tenantId}
    order by created_at desc limit 1`
  expect(await agregarLinea(c.fd({ orderId: o!.id, productId: cemento, qty }))).toEqual({
    ok: true,
  })
  return o!.id
}

async function lineaDe(orden: string): Promise<string> {
  const [l] = await db()<{ id: string }[]>`
    select id from public.transfer_order_lines where order_id = ${orden} and tenant_id = ${c.tenantId}`
  return l!.id
}

function recibir(orden: string, linea: string, qty: string) {
  const f = c.fd({ orderId: orden })
  f.append('lineId', linea)
  f.append('qtyReceived', qty)
  return recibirTransferencia(f)
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-transferencias',
    nombre: 'Distribuidora Traslados SRL',
    modulos: ['products', 'inventory', 'transfers'],
    roles: { Almacenista: { '*': true } },
  })
  const sql = db()
  const [a] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, is_default)
    values (${c.tenantId}, 'Santo Domingo', true) returning id`
  const [b] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name) values (${c.tenantId}, 'Santiago') returning id`
  origen = a!.id
  destino = b!.id
  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, price, tax_rate)
    values (${c.tenantId}, 'CEM-100', 'Cemento gris 42.5 kg', 'saco', 465, 0.18) returning id`
  cemento = p!.id
  const [s] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, price, tax_rate, tracks_stock)
    values (${c.tenantId}, 'ENVIO', 'Envio a domicilio', 'und', 500, 0.18, false) returning id`
  servicio = s!.id
  // 55 sacos a 411.50 en el origen, por el camino normal.
  await sql`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost)
    values (${c.tenantId}, ${origen}, ${cemento}, 'adjustment_in', 55, 411.5)`
})

afterAll(async () => {
  const sql = db()
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    for (const t of [
      'transfer_order_lines',
      'transfer_orders',
      'inventory_movements',
      'stock_levels',
      'products',
      'warehouses',
    ]) {
      await tx.unsafe(`delete from public.${t} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar()
  await cerrarBase()
})

describe('despachar', () => {
  it('no deja despachar mas de lo que hay en el origen, y no mueve nada', async () => {
    const orden = await nuevaTransferencia('60')
    const r = await despacharTransferencia(c.fd({ orderId: orden }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/CEM-100: hay 55, se piden 60/)
    expect((await existencia(origen)).qty).toBe(55)
    const [o] = await db()<
      { status: string }[]
    >`select status from public.transfer_orders where id = ${orden}`
    expect(o!.status).toBe('draft')
  })

  it('un servicio no se agrega a una transferencia', async () => {
    const [o] = await db()<{ id: string }[]>`
      select id from public.transfer_orders where tenant_id = ${c.tenantId} and status = 'draft'
      order by created_at desc limit 1`
    const r = await agregarLinea(c.fd({ orderId: o!.id, productId: servicio, qty: '1' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/servicio/)
  })
})

describe('el costo viaja con la mercancia (0137)', () => {
  let orden: string

  it('la salida lleva el costo promedio del origen', async () => {
    orden = await nuevaTransferencia('10')
    expect(await despacharTransferencia(c.fd({ orderId: orden }))).toEqual({ ok: true })
    const [m] = await db()<{ costo: string }[]>`
      select unit_cost::text as costo from public.inventory_movements
      where tenant_id = ${c.tenantId} and reference_id = ${orden} and movement_type = 'transfer_out'`
    expect(Number(m!.costo)).toBe(411.5)
    expect(await existencia(origen)).toEqual({ qty: 45, avg: 411.5 })
  })

  it('recibir MAS de lo que salio es un error y no escribe nada', async () => {
    const r = await recibir(orden, await lineaDe(orden), '12')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/salieron 10 y no pueden llegar 12/)
    expect((await existencia(destino)).qty).toBe(0)
  })

  it('una linea en blanco no se salta: se pide la cantidad', async () => {
    const r = await recibir(orden, await lineaDe(orden), '')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/escribe cuanto llego/)
  })

  it('en el destino entra con el costo con el que salio, no a cero', async () => {
    // Llegan 8 de 10: la diferencia es la discrepancia, no un error.
    expect(await recibir(orden, await lineaDe(orden), '8')).toEqual({ ok: true })
    expect(await existencia(destino)).toEqual({ qty: 8, avg: 411.5 })
  })

  it('aunque el promedio del origen cambie mientras viaja, entra al costo de la salida', async () => {
    const segunda = await nuevaTransferencia('5')
    expect(await despacharTransferencia(c.fd({ orderId: segunda }))).toEqual({ ok: true })
    // Mientras el camion va por la autopista, entra una compra cara al origen.
    await db()`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost)
      values (${c.tenantId}, ${origen}, ${cemento}, 'receipt', 40, 500)`
    expect(await recibir(segunda, await lineaDe(segunda), '5')).toEqual({ ok: true })
    // (8 x 411.50 + 5 x 411.50) / 13: el precio nuevo del origen no viaja.
    expect(await existencia(destino)).toEqual({ qty: 13, avg: 411.5 })
  })
})
