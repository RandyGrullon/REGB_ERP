import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import {
  cancelarDevolucion,
  enviarDevolucion,
  registrarDevolucion,
  registrarRecepcion,
} from './actions'

/**
 * Recepciones con las acciones reales (hallazgos 2 y 11 del analisis de
 * flujo):
 *
 *  - Recibir MENOS de lo pedido es el caso normal de una recepcion
 *    parcial. Antes, cualquier inconsistencia de la inspeccion hacia
 *    `throw` dentro de la accion y la pantalla entera se caia; ahora
 *    vuelve un error legible y no escribe nada.
 *  - Una devolucion al proveedor solo saca del inventario lo que de verdad
 *    ENTRO (lo aceptado). Lo rechazado nunca entro al on_hand: devolverlo
 *    se documenta, pero no puede restar existencia.
 */

let c: ClientePrueba
let almacen: string
let producto: string
let proveedor: string
let orden: string
let linea: string

async function existencia(): Promise<{ qty: number; avg: number }> {
  const [s] = await db()<{ qty: string; avg: string }[]>`
    select qty_on_hand::text as qty, avg_cost::text as avg from public.stock_levels
    where tenant_id = ${c.tenantId} and warehouse_id = ${almacen} and product_id = ${producto}`
  return { qty: Number(s?.qty ?? 0), avg: Number(s?.avg ?? 0) }
}

async function recepciones(): Promise<number> {
  const [n] = await db()<{ n: number }[]>`
    select count(*)::int as n from public.goods_receipts where tenant_id = ${c.tenantId}`
  return n!.n
}

function recibir(campos: {
  qtyReceived: string
  qtyAccepted?: string
  qtyRejected?: string
  rejectionReason?: string
  unitCost?: string
  lineId?: string
}) {
  const f = c.fd({ orderId: orden })
  f.append('lineId', campos.lineId ?? linea)
  f.append('qtyReceived', campos.qtyReceived)
  f.append('qtyAccepted', campos.qtyAccepted ?? '')
  f.append('qtyRejected', campos.qtyRejected ?? '')
  f.append('rejectionReason', campos.rejectionReason ?? '')
  f.append('unitCost', campos.unitCost ?? '')
  return registrarRecepcion(f)
}

async function lineaDeRecepcion(): Promise<{ id: string; accepted: number; rejected: number; cost: number }> {
  const [l] = await db()<{ id: string; accepted: string; rejected: string; cost: string }[]>`
    select id, qty_accepted::text as accepted, qty_rejected::text as rejected, unit_cost::text as cost
    from public.goods_receipt_lines where tenant_id = ${c.tenantId}
    order by created_at desc limit 1`
  return { id: l!.id, accepted: Number(l!.accepted), rejected: Number(l!.rejected), cost: Number(l!.cost) }
}

async function devolucionPendiente(origen: string): Promise<string> {
  const [d] = await db()<{ id: string }[]>`
    select id from public.supplier_returns
    where tenant_id = ${c.tenantId} and status = 'pending' and origin = ${origen}
    order by created_at desc limit 1`
  return d!.id
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-recepciones',
    nombre: 'Ferreteria Recepciones SRL',
    modulos: ['products', 'inventory', 'purchase-orders', 'receipts', 'suppliers'],
    roles: { Almacenista: { '*': true } },
  })
  const sql = db()
  const [w] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, is_default)
    values (${c.tenantId}, 'Almacen Santiago', true) returning id`
  almacen = w!.id
  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, price, tax_rate)
    values (${c.tenantId}, 'CEM-100', 'Cemento gris 42.5 kg', 'saco', 465, 0.18) returning id`
  producto = p!.id
  const [s] = await sql<{ id: string }[]>`
    insert into public.suppliers (tenant_id, name, payment_terms)
    values (${c.tenantId}, 'Cementos del Caribe SRL', 30) returning id`
  proveedor = s!.id
  const [o] = await sql<{ id: string }[]>`
    insert into public.purchase_orders (tenant_id, number, supplier_id, warehouse_id, status)
    values (${c.tenantId}, 'OC-PRUEBA-0001', ${proveedor}, ${almacen}, 'confirmed') returning id`
  orden = o!.id
  const [l] = await sql<{ id: string }[]>`
    insert into public.purchase_order_lines (order_id, tenant_id, product_id, qty_ordered, unit_cost)
    values (${orden}, ${c.tenantId}, ${producto}, 50, 240) returning id`
  linea = l!.id
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

describe('recibir menos de lo pedido', () => {
  it('una inspeccion que no suma devuelve un error legible, no una excepcion, y no escribe nada', async () => {
    // Lo que mandaba la pantalla vieja: "Aceptado" precargado con lo PEDIDO
    // (50) y el almacenista solo corrige "Recibido" a 30.
    const r = await recibir({ qtyReceived: '30', qtyAccepted: '50', qtyRejected: '0' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Cemento gris.*debe sumar lo recibido/)
    expect(await recepciones()).toBe(0)
    expect((await existencia()).qty).toBe(0)
  })

  it('una linea de otra orden tambien es un error legible', async () => {
    const r = await recibir({ qtyReceived: '1', lineId: crypto.randomUUID() })
    expect(r).toEqual({ ok: false, error: 'Esa linea no pertenece a esta orden.' })
  })

  it('recibir 30 de 50 con 2 rechazados, sin escribir "Aceptado", es una recepcion parcial', async () => {
    const r = await recibir({
      qtyReceived: '30',
      qtyRejected: '2',
      rejectionReason: 'Sacos mojados',
      unitCost: '255',
    })
    expect(r).toEqual({ ok: true })

    const l = await lineaDeRecepcion()
    expect(l.accepted).toBe(28)
    expect(l.rejected).toBe(2)
    // Solo lo aceptado entra al inventario vendible.
    expect(await existencia()).toEqual({ qty: 28, avg: 255 })

    const [o] = await db()<{ status: string; recibido: string }[]>`
      select o.status, l.qty_received::text as recibido
      from public.purchase_orders o join public.purchase_order_lines l on l.order_id = o.id
      where o.id = ${orden}`
    expect(o!.status).toBe('partially_received')
    expect(Number(o!.recibido)).toBe(30)
  })

  it('un costo en blanco toma el cotizado de la orden, no cero', async () => {
    // Antes un costo vacio se guardaba como 0 y hundia el costo promedio.
    const r = await recibir({ qtyReceived: '4' })
    expect(r).toEqual({ ok: true })
    const l = await lineaDeRecepcion()
    expect(l.cost).toBe(240)
    // (28 x 255 + 4 x 240) / 32 = 253.125
    expect(await existencia()).toEqual({ qty: 32, avg: 253.125 })
  })
})

describe('devolucion al proveedor', () => {
  let recepcionConRechazo: string

  beforeAll(async () => {
    const [l] = await db()<{ id: string }[]>`
      select id from public.goods_receipt_lines
      where tenant_id = ${c.tenantId} and qty_rejected > 0`
    recepcionConRechazo = l!.id
  })

  it('devolver lo RECHAZADO no resta existencia: nunca entro al inventario', async () => {
    const antes = await existencia()
    expect(
      await registrarDevolucion(
        c.fd({ goodsReceiptLineId: recepcionConRechazo, qty: '2', reason: 'Sacos mojados' }),
      ),
    ).toEqual({ ok: true })
    expect(await enviarDevolucion(c.fd({ devolucionId: await devolucionPendiente('rejected') }))).toEqual({
      ok: true,
    })
    expect(await existencia()).toEqual(antes)

    const [m] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.inventory_movements
      where tenant_id = ${c.tenantId} and movement_type = 'return_to_supplier'`
    expect(m!.n).toBe(0)
  })

  it('no se puede devolver mas rechazado del que hubo', async () => {
    const r = await registrarDevolucion(
      c.fd({ goodsReceiptLineId: recepcionConRechazo, qty: '1', reason: 'Otro saco' }),
    )
    expect(r.ok).toBe(false)
  })

  it('de lo ACEPTADO solo se devuelve hasta lo aceptado', async () => {
    const r = await registrarDevolucion(
      c.fd({
        goodsReceiptLineId: recepcionConRechazo,
        origin: 'accepted',
        qty: '29',
        reason: 'Salio con grumos',
      }),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/28/)
  })

  it('devolver lo aceptado si sale del almacen, por la cantidad devuelta', async () => {
    const antes = await existencia()
    expect(
      await registrarDevolucion(
        c.fd({
          goodsReceiptLineId: recepcionConRechazo,
          origin: 'accepted',
          qty: '3',
          reason: 'Salio con grumos',
        }),
      ),
    ).toEqual({ ok: true })
    expect(await enviarDevolucion(c.fd({ devolucionId: await devolucionPendiente('accepted') }))).toEqual({
      ok: true,
    })
    expect((await existencia()).qty).toBe(antes.qty - 3)
  })

  it('una devolucion cancelada libera su cupo', async () => {
    expect(
      await registrarDevolucion(
        c.fd({ goodsReceiptLineId: recepcionConRechazo, origin: 'accepted', qty: '25', reason: 'Lote malo' }),
      ),
    ).toEqual({ ok: true })
    expect(
      await cancelarDevolucion(c.fd({ devolucionId: await devolucionPendiente('accepted') })),
    ).toEqual({ ok: true })
    expect(
      await registrarDevolucion(
        c.fd({ goodsReceiptLineId: recepcionConRechazo, origin: 'accepted', qty: '25', reason: 'Lote malo' }),
      ),
    ).toEqual({ ok: true })
  })

  it('la base tambien pone el tope, aunque alguien se salte la accion', async () => {
    await expect(
      db()`
        insert into public.supplier_returns (tenant_id, goods_receipt_line_id, supplier_id, qty, reason, origin)
        values (${c.tenantId}, ${recepcionConRechazo}, ${proveedor}, 1, 'Por SQL directo', 'accepted')`,
    ).rejects.toThrow(/disponibles para devolver/)
  })
})
