import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import {
  MODULOS_CREDITO,
  almacen,
  cliente,
  limpiarCredito,
  pedido,
  producto,
  secuencia,
} from '@/test/venta-a-credito'
import {
  agregarLinea,
  cancelarPedido,
  confirmarPedido,
  crearCliente,
  editarCliente,
  entregarLinea,
} from './actions'
import { facturarPedido } from '../cobrar/actions'

/**
 * Pedidos a credito coherentes (analisis de flujo, hallazgo 18), llamando
 * a las acciones DE VERDAD:
 *
 *  1. Un pedido sin existencia quedaba en borrador aunque el aviso dijera
 *     "quedo hecho".
 *  2. Se podia cancelar un pedido ya entregado (y facturado).
 *  3. La lista de precios asignada al cliente se ignoraba.
 *  4. El cliente no se podia editar: un RNC malo se quedaba asi.
 *
 * Cada caso se vio en rojo rompiendo el arreglo a proposito.
 */

const VENDEDOR = { 'sales-orders.*': true, 'ar.view': true, 'products.view': true }
const DUENO = { '*': true }

let c: ClientePrueba
let wh: string

async function estado(orderId: string): Promise<string> {
  const [o] = await db()<{ status: string }[]>`select status from public.sales_orders where id = ${orderId}`
  return o!.status
}

async function lineaDe(orderId: string) {
  const [l] = await db()<{ id: string; unit_price: string; qty_reserved: string }[]>`
    select id, unit_price::text, qty_reserved::text from public.sales_order_lines
    where order_id = ${orderId}`
  return l!
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-pedidos',
    nombre: 'Ferreteria de Prueba SRL',
    modulos: [...MODULOS_CREDITO, 'price-lists'],
    roles: { Vendedor: VENDEDOR, Dueno: DUENO },
  })
  wh = await almacen(c.tenantId)
  await secuencia(c.tenantId, 'B02')
})

afterAll(async () => {
  await db()`delete from public.price_list_entries where tenant_id = ${c.tenantId}`
  await db()`update public.customers set price_list_id = null where tenant_id = ${c.tenantId}`
  await db()`delete from public.price_lists where tenant_id = ${c.tenantId}`
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

// ─────────────────────────────────────────────────────────────────────────
describe('Confirmar sin existencia', () => {
  it('queda confirmado con todo en backorder, no en borrador', async () => {
    const sinStock = await producto(c.tenantId, wh, { sku: 'SIN-STOCK', precio: 100 })
    const cli = await cliente(c.tenantId, { nombre: 'Cliente Backorder' })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: sinStock,
      cantidad: 5,
      precio: 100,
      estado: 'draft',
    })
    expect(await confirmarPedido(c.fd({ orderId: ped }, 'Vendedor'))).toEqual({ ok: true })
    expect(await estado(ped)).toBe('confirmed')
    expect(Number((await lineaDe(ped)).qty_reserved)).toBe(0)

    // Y no se puede "confirmar otra vez" como si siguiera en borrador.
    const r = await confirmarPedido(c.fd({ orderId: ped }, 'Vendedor'))
    expect(r.ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Cancelar un pedido', () => {
  let prod: string

  beforeAll(async () => {
    prod = await producto(c.tenantId, wh, { sku: 'CANC-1', precio: 200, existencia: 100 })
  })

  it('entregado completo no se cancela: se devuelve con nota de credito', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente Entregado' })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 3,
      precio: 200,
      estado: 'delivered',
    })
    const r = await cancelarPedido(c.fd({ orderId: ped }, 'Vendedor'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/nota de credito/)
    expect(await estado(ped)).toBe('delivered')
  })

  it('entregado y facturado tampoco', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente Facturado' })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 2,
      precio: 200,
      estado: 'delivered',
    })
    expect(await facturarPedido(c.fd({ orderId: ped }, 'Dueno'))).toEqual({ ok: true })
    const r = await cancelarPedido(c.fd({ orderId: ped }, 'Vendedor'))
    expect(r.ok).toBe(false)
    expect(await estado(ped)).toBe('delivered')
  })

  it('entregado a medias: se cancela el resto y lo entregado se sigue pudiendo facturar', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente A Medias' })
    const ped = await pedido(c.tenantId, {
      customerId: cli,
      warehouseId: wh,
      productId: prod,
      cantidad: 10,
      precio: 200,
      estado: 'draft',
    })
    expect(await confirmarPedido(c.fd({ orderId: ped }, 'Vendedor'))).toEqual({ ok: true })
    const l = await lineaDe(ped)
    expect(await entregarLinea(c.fd({ orderId: ped, lineId: l.id, qty: '4' }, 'Vendedor'))).toEqual({
      ok: true,
    })
    expect(await cancelarPedido(c.fd({ orderId: ped }, 'Vendedor'))).toEqual({ ok: true })
    expect(await estado(ped)).toBe('cancelled')

    // Lo apartado de las 6 que no salieron volvio al almacen.
    expect(Number((await lineaDe(ped)).qty_reserved)).toBe(0)

    // Las 4 que si salieron se facturan: cancelar no regala mercancia.
    expect(await facturarPedido(c.fd({ orderId: ped }, 'Dueno'))).toEqual({ ok: true })
    const [f] = await db()<{ total: string; qty: string }[]>`
      select i.total::text, (select sum(qty) from public.customer_invoice_lines
                              where invoice_id = i.id)::text as qty
      from public.customer_invoices i
      where i.source_type = 'sales_order' and i.source_id = ${ped}`
    expect(Number(f!.qty)).toBe(4)
    expect(Number(f!.total)).toBe(944) // 4 x 200 + 18%
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('La lista de precios asignada al cliente', () => {
  let prod: string
  let asignado: string
  let sinAsignar: string

  beforeAll(async () => {
    prod = await producto(c.tenantId, wh, { sku: 'LISTA-1', precio: 1000, existencia: 50 })
    // "Detalle" es la general mas reciente: la que toca a quien no tiene
    // lista asignada.
    const [detalle] = await db()<{ id: string }[]>`
      insert into public.price_lists (tenant_id, name, scope, start_date)
      values (${c.tenantId}, 'Detalle', 'general', current_date - 10) returning id`
    const [mayorista] = await db()<{ id: string }[]>`
      insert into public.price_lists (tenant_id, name, scope, start_date)
      values (${c.tenantId}, 'Mayorista', 'general', current_date - 100) returning id`
    await db()`
      insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
      values (${c.tenantId}, ${detalle!.id}, ${prod}, 1, 950),
             (${c.tenantId}, ${mayorista!.id}, ${prod}, 1, 800)`
    asignado = await cliente(c.tenantId, { nombre: 'Distribuidor Mayorista SRL' })
    sinAsignar = await cliente(c.tenantId, { nombre: 'Cliente de Detalle' })
    await db()`update public.customers set price_list_id = ${mayorista!.id} where id = ${asignado}`
  })

  async function precioAgregado(customerId: string): Promise<number> {
    const [o] = await db()<{ id: string }[]>`
      insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id)
      values (${c.tenantId}, ${`PV-L-${crypto.randomUUID().slice(0, 6)}`}, ${customerId}, ${wh})
      returning id`
    const r = await agregarLinea(c.fd({ orderId: o!.id, productId: prod, qty: '2' }, 'Vendedor'))
    expect(r).toEqual({ ok: true })
    return Number((await lineaDe(o!.id)).unit_price)
  }

  it('el cliente con la lista Mayorista asignada paga el precio de esa lista', async () => {
    expect(await precioAgregado(asignado)).toBe(800)
  })

  it('el que no tiene lista asignada sigue con la general que le toca', async () => {
    expect(await precioAgregado(sinAsignar)).toBe(950)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Ficha del cliente', () => {
  it('un RNC malo se corrige; uno invalido no se guarda', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Ferreteria El Martillo SRL', rnc: '131223345' })
    const malo = await editarCliente(
      c.fd({ id: cli, name: 'Ferreteria El Martillo SRL', taxId: '131-22334-4', terms: '30' }, 'Vendedor'),
    )
    expect(malo.ok).toBe(false)

    const bueno = await editarCliente(
      c.fd({ id: cli, name: 'Ferreteria El Martillo SRL', taxId: '401-00755-1', terms: '15' }, 'Vendedor'),
    )
    expect(bueno).toEqual({ ok: true })
    const [f] = await db()<{ tax_id: string; payment_terms: number }[]>`
      select tax_id, payment_terms from public.customers where id = ${cli}`
    expect(f).toEqual({ tax_id: '401007551', payment_terms: 15 })
  })

  it('el vendedor edita datos pero no fija el limite de credito', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente Limite' })
    const r = await editarCliente(
      c.fd({ id: cli, name: 'Cliente Limite', terms: '30', creditLimit: '999999' }, 'Vendedor'),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/ar\.credit\.manage/)
    const [f] = await db()<{ credit_limit: string | null }[]>`
      select credit_limit::text from public.customers where id = ${cli}`
    expect(f!.credit_limit).toBeNull()
  })

  it('el dueno si; vacio quita el limite', async () => {
    const cli = await cliente(c.tenantId, { nombre: 'Cliente Con Limite' })
    expect(
      await editarCliente(
        c.fd({ id: cli, name: 'Cliente Con Limite', terms: '30', creditLimit: '75,000' }, 'Dueno'),
      ),
    ).toEqual({ ok: true })
    let [f] = await db()<{ credit_limit: string | null }[]>`
      select credit_limit::text from public.customers where id = ${cli}`
    expect(Number(f!.credit_limit)).toBe(75000)

    await editarCliente(c.fd({ id: cli, name: 'Cliente Con Limite', terms: '30', creditLimit: '' }, 'Dueno'))
    ;[f] = await db()<{ credit_limit: string | null }[]>`
      select credit_limit::text from public.customers where id = ${cli}`
    expect(f!.credit_limit).toBeNull()
  })

  it('el alta tambien acepta el limite, solo con permiso', async () => {
    const r = await crearCliente(
      c.fd({ name: 'Alta Con Limite SRL', terms: '30', creditLimit: '50000' }, 'Vendedor'),
    )
    expect(r.ok).toBe(false)
    expect(
      await crearCliente(c.fd({ name: 'Alta Con Limite SRL', terms: '30', creditLimit: '50000' }, 'Dueno')),
    ).toEqual({ ok: true })
  })
})
