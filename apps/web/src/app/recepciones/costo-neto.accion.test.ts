import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { registrarRecepcion } from './actions'
import { cancelarOrden, quitarLinea, recibirLinea } from '../compras/actions'

/**
 * El costo con el que entra la mercancia (cliente misterioso, 23 sep):
 *
 *  - Una linea de compra a 420 con 5% de descuento entraba al inventario
 *    a 420 y no a 399. El costo promedio -y el costo de ventas, y el
 *    margen- quedaba inflado por lo que el comprador SI negocio. Pasaba en
 *    los dos caminos de recibir: Recepciones y la ficha de la orden.
 *  - El almacenista no tiene `inventory.cost.view` (0109), pero la
 *    pantalla de recepcion le precargaba el costo y la accion aceptaba el
 *    que escribiera: el rol que no puede VER el costo podia FIJARLO.
 *  - La ficha de la orden recibia una linea de OTRA orden si se la
 *    pasaban, y dejaba cancelar una orden ya recibida completa.
 */

let c: ClientePrueba
let almacen: string
let cemento: string
let pintura: string
let proveedor: string

async function existencia(producto: string): Promise<{ qty: number; avg: number }> {
  const [s] = await db()<{ qty: string; avg: string }[]>`
    select qty_on_hand::text as qty, avg_cost::text as avg from public.stock_levels
    where tenant_id = ${c.tenantId} and warehouse_id = ${almacen} and product_id = ${producto}`
  return { qty: Number(s?.qty ?? 0), avg: Number(s?.avg ?? 0) }
}

async function orden(numero: string, producto: string, costo: number, descuento: number) {
  const sql = db()
  const [o] = await sql<{ id: string }[]>`
    insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id, status)
    values (${c.tenantId}, ${numero}, ${proveedor}, ${almacen}, 'confirmed') returning id`
  const [l] = await sql<{ id: string }[]>`
    insert into public.purchase_order_lines
      (order_id, tenant_id, product_id, qty_ordered, unit_cost, discount_pct)
    values (${o!.id}, ${c.tenantId}, ${producto}, 30, ${costo}, ${descuento}) returning id`
  return { orden: o!.id, linea: l!.id }
}

function recibir(ordenId: string, lineId: string, qty: string, rol?: string, unitCost = '') {
  const f = c.fd({ orderId: ordenId }, rol)
  f.append('lineId', lineId)
  f.append('qtyReceived', qty)
  f.append('qtyAccepted', '')
  f.append('qtyRejected', '')
  f.append('rejectionReason', '')
  f.append('unitCost', unitCost)
  return registrarRecepcion(f)
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-costo-neto',
    nombre: 'Distribuidora Costo Neto SRL',
    modulos: ['products', 'inventory', 'purchase-orders', 'receipts', 'suppliers'],
    roles: {
      Comprador: { '*': true },
      // El almacenista de fabrica: recibe, pero el costo lo tiene negado.
      Almacenista: {
        'receipts.receive': true,
        'receipts.view': true,
        'inventory.cost.view': false,
      },
    },
  })
  const sql = db()
  const [w] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, is_default)
    values (${c.tenantId}, 'Almacen Santiago', true) returning id`
  almacen = w!.id
  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, price, tax_rate)
    values (${c.tenantId}, 'CEM-100', 'Cemento gris 42.5 kg', 'saco', 465, 0.18) returning id`
  cemento = p!.id
  const [q] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, price, tax_rate)
    values (${c.tenantId}, 'PIN-300', 'Pintura blanca', 'galon', 890, 0.18) returning id`
  pintura = q!.id
  const [s] = await sql<{ id: string }[]>`
    insert into public.suppliers (tenant_id, name, payment_terms)
    values (${c.tenantId}, 'Ferreteria Central Import SRL', 0) returning id`
  proveedor = s!.id
})

afterAll(async () => {
  const sql = db()
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`
    for (const t of [
      'supplier_returns',
      'goods_receipt_lines',
      'goods_receipts',
      'inventory_movements',
      'stock_levels',
      'purchase_order_lines',
      'purchase_orders',
      'suppliers',
      'products',
      'warehouses',
    ]) {
      await tx.unsafe(`delete from public.${t} where tenant_id = $1`, [c.tenantId])
    }
  })
  await c.limpiar()
  await cerrarBase()
})

describe('Recepciones: costo neto del descuento', () => {
  it('con el costo en blanco, entra a lo cotizado MENOS el descuento: 420 al 5% = 399', async () => {
    const { orden: o, linea } = await orden('OC-NETO-1', cemento, 420, 5)
    expect(await recibir(o, linea, '10')).toEqual({ ok: true })
    expect(await existencia(cemento)).toEqual({ qty: 10, avg: 399 })
  })

  it('el almacenista sin costo no fija el costo aunque lo mande en el formulario', async () => {
    const { orden: o, linea } = await orden('OC-NETO-2', pintura, 600, 10)
    // Un costo de 1 escrito a mano (por la consola): se ignora.
    expect(await recibir(o, linea, '10', 'Almacenista', '1')).toEqual({ ok: true })
    // Entra a 600 - 10% = 540, el neto de la orden.
    expect(await existencia(pintura)).toEqual({ qty: 10, avg: 540 })
  })

  it('quien si ve costos puede declarar el real de la entrega', async () => {
    const { orden: o, linea } = await orden('OC-NETO-3', pintura, 600, 10)
    expect(await recibir(o, linea, '10', 'Comprador', '560')).toEqual({ ok: true })
    // (10 x 540 + 10 x 560) / 20 = 550
    expect(await existencia(pintura)).toEqual({ qty: 20, avg: 550 })
  })
})

describe('Ficha de la orden: recibir sin Recepciones', () => {
  it('con el costo en blanco tambien entra neto del descuento', async () => {
    const { orden: o, linea } = await orden('OC-NETO-4', cemento, 420, 5)
    expect(
      await recibirLinea(c.fd({ orderId: o, lineId: linea, qty: '10', unitCost: '' })),
    ).toEqual({
      ok: true,
    })
    // 10 a 399 + 10 a 399
    expect(await existencia(cemento)).toEqual({ qty: 20, avg: 399 })
  })

  it('una linea de OTRA orden no se recibe en esta', async () => {
    const a = await orden('OC-NETO-5', cemento, 420, 0)
    const b = await orden('OC-NETO-6', cemento, 420, 0)
    const r = await recibirLinea(
      c.fd({ orderId: a.orden, lineId: b.linea, qty: '1', unitCost: '' }),
    )
    expect(r).toEqual({ ok: false, error: 'Esa linea no existe.' })
  })

  it('una orden recibida completa ya no se cancela', async () => {
    const { orden: o, linea } = await orden('OC-NETO-7', cemento, 420, 0)
    expect(
      await recibirLinea(c.fd({ orderId: o, lineId: linea, qty: '30', unitCost: '' })),
    ).toEqual({
      ok: true,
    })
    const r = await cancelarOrden(c.fd({ orderId: o }))
    expect(r.ok).toBe(false)
    const [e] = await db()<
      { status: string }[]
    >`select status from public.purchase_orders where id = ${o}`
    expect(e!.status).toBe('received')
  })

  it('quitar una linea de una orden ya confirmada dice que no, en vez de "lo eliminamos"', async () => {
    const { orden: o, linea } = await orden('OC-NETO-8', cemento, 420, 0)
    const r = await quitarLinea(c.fd({ orderId: o, lineId: linea }))
    expect(r.ok).toBe(false)
    const [n] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.purchase_order_lines where order_id = ${o}`
    expect(n!.n).toBe(1)
  })
})
