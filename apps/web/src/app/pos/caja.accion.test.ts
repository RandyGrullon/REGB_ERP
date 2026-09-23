import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { buscarProductoCaja, cobrarVenta } from './actions'

/**
 * La caja llamada DE VERDAD: tope de descuento del rol, resultado del
 * cobro con su NCF, y el escaneo de un codigo que no estaba cargado.
 *
 * Salieron de usar la caja como un colmado: el descuento del Cajero nunca
 * funcionaba (tenia el tope pero no el permiso) y, cuando lo tenga, nada
 * impedia pasarse del tope mandando otro numero desde el navegador.
 */

let c: ClientePrueba
let turno: string
let arroz: string

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-caja',
    nombre: 'Colmado de Prueba SRL',
    modulos: ['pos', 'products', 'inventory'],
    roles: {
      // El Cajero de fabrica tras 0135: descuenta hasta 10%.
      Cajero: { 'pos.sell': true, 'pos.discount': true, 'pos.discount.max': 10 } as never,
      Supervisor: { 'pos.*': true },
    },
  })
  const sql = db()
  const [w] = await sql<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${c.tenantId}, 'Caja principal', 'CAJA', true) returning id`
  const [s] = await sql<{ id: string }[]>`
    insert into public.pos_shifts (tenant_id, warehouse_id, cashier_id, opening_float)
    values (${c.tenantId}, ${w!.id}, '00000000-0000-0000-0000-000000000001', 0) returning id`
  turno = s!.id
  const [p] = await sql<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, unit, price, tax_rate, tracks_stock, barcode)
    values (${c.tenantId}, 'ARZ-9', 'Arroz de prueba', 'funda', 100, 0, false, '7460000000017')
    returning id`
  arroz = p!.id
})

afterAll(async () => {
  await c.limpiar([
    'public.pos_payments',
    'public.pos_sale_lines',
    'public.pos_sales',
    'public.pos_shifts',
    'public.products',
    'public.warehouses',
  ])
  await cerrarBase()
})

const venta = (descuento: number, total: number, rol = 'Cajero') =>
  c.fd(
    {
      shiftId: turno,
      cart: JSON.stringify([{ productId: arroz, qty: 1, discountPct: descuento }]),
      payments: JSON.stringify([{ method: 'cash', amount: total }]),
    },
    rol,
  )

describe('tope de descuento del rol', () => {
  it('el Cajero descuenta dentro de su tope y la venta entra con su total', async () => {
    const r = await cobrarVenta(venta(10, 90))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.venta?.total).toBe(90)
  })

  it('pasarse del tope se rechaza en el servidor, aunque el navegador lo mande', async () => {
    const r = await cobrarVenta(venta(15, 85))
    expect(r).toEqual({
      ok: false,
      error: 'Tu rol puede descontar hasta 10%. Un descuento mayor lo aplica un supervisor.',
    })
  })

  it('un rol sin tope descuenta lo que haga falta', async () => {
    const r = await cobrarVenta(venta(15, 85, 'Supervisor'))
    expect(r.ok).toBe(true)
  })
})

describe('escaneo de un codigo que la caja no cargo', () => {
  it('lo encuentra en el catalogo completo por codigo de barras o SKU', async () => {
    const porBarras = await buscarProductoCaja('7460000000017', turno, {
      tenant: c.slug,
      rol: 'Cajero',
    })
    expect(porBarras?.id).toBe(arroz)
    const porSku = await buscarProductoCaja('arz-9', turno, { tenant: c.slug, rol: 'Cajero' })
    expect(porSku?.id).toBe(arroz)
  })

  it('un codigo que no existe devuelve null, sin error', async () => {
    const r = await buscarProductoCaja('0000000000000', turno, { tenant: c.slug, rol: 'Cajero' })
    expect(r).toBeNull()
  })
})
