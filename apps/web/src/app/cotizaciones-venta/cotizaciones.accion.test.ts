import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { MODULOS_CREDITO, almacen, cliente, limpiarCredito, producto } from '@/test/venta-a-credito'
import {
  agregarLinea,
  convertirEnPedido,
  crearCotizacion,
  crearVersionNueva,
  quitarLinea,
  transicionarCotizacion,
} from './actions'

/**
 * Cotizacion -> pedido, llamando a las acciones DE VERDAD (cliente
 * misterioso, 23 sep 2026, como dueno y vendedor de una distribuidora):
 *
 *  1. El precio de cada linea era un campo obligatorio y vacio: cada
 *     vendedor cotizaba el precio que recordaba, no el de la lista del
 *     cliente. Vacio ahora toma la lista (o el catalogo).
 *  2. Se podian agregar y quitar lineas a una cotizacion ya enviada o
 *     aprobada llamando la accion: lo que el cliente acepto cambiaba.
 *  3. Se podia "enviar" una cotizacion vacia.
 *  4. Una aprobada no llevaba a ningun lado: el pedido se tecleaba otra vez.
 *  5. Numerar contando filas saltaba numeros despues de una version nueva.
 */

// Render en servidor de las pantallas (como cobrar/pantallas.accion.test.ts).
;(globalThis as { React?: typeof React }).React = React
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect(${url})`)
  },
  notFound: () => {
    throw new Error('notFound()')
  },
  usePathname: () => '/cotizaciones-venta',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

type Pagina = (p: {
  params?: Promise<Record<string, string>>
  searchParams: Promise<Record<string, string>>
}) => Promise<ReactElement>

async function pintar(
  modulo: Promise<{ default: unknown }>,
  id: string,
  rol = 'Vendedor',
): Promise<string> {
  const Page = (await modulo).default as Pagina
  const el = await Page({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({ tenant: c.slug, rol }),
  })
  return renderToStaticMarkup(createElement(() => el))
}

const VENDEDOR = {
  'quotes.view': true,
  'quotes.manage': true,
  'sales-orders.view': true,
  'sales-orders.create': true,
  'products.view': true,
}
const SOLO_COTIZA = { 'quotes.view': true, 'quotes.manage': true }

const MODULOS = [...MODULOS_CREDITO, 'quotes', 'price-lists']

let c: ClientePrueba
let wh: string
let cemento: string
let colmado: string

async function lineas(quoteId: string) {
  return db()<{ unit_price: string; quantity: string }[]>`
    select unit_price::text, quantity::text from public.quote_lines where quote_id = ${quoteId}
    order by unit_price`
}

async function nuevaCotizacion(customerId: string | null): Promise<string> {
  const r = await crearCotizacion(c.fd(customerId ? { customerId } : {}, 'Vendedor'))
  expect(r.ok).toBe(true)
  if (!r.ok) throw new Error(r.error)
  return r.quoteId!
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-cotizaciones',
    nombre: 'Distribuidora de Prueba SRL',
    modulos: MODULOS,
    roles: { Vendedor: VENDEDOR, SoloCotiza: SOLO_COTIZA },
  })
  wh = await almacen(c.tenantId)
  cemento = await producto(c.tenantId, wh, { sku: 'CEM-100', precio: 465, existencia: 100 })
  colmado = await cliente(c.tenantId, { nombre: 'Colmado La Bendicion SRL', dias: 15 })

  // Lista del cliente: 440 desde 1 saco, 425 desde 20.
  const [lista] = await db()<{ id: string }[]>`
    insert into public.price_lists (tenant_id, name, scope, customer_id, start_date)
    values (${c.tenantId}, 'Colmados 2026', 'customer', ${colmado}, current_date - 1) returning id`
  await db()`
    insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
    values (${c.tenantId}, ${lista!.id}, ${cemento}, 1, 440),
           (${c.tenantId}, ${lista!.id}, ${cemento}, 20, 425)`
})

afterAll(async () => {
  // Las lineas caen en cascada con su cotizacion (borrarlas sueltas lo
  // impide la 0080 fuera de borrador). Antes que los pedidos: la
  // cotizacion apunta a su pedido.
  await db()`delete from public.quotes where tenant_id = ${c.tenantId}`
  await db()`delete from public.price_list_entries where tenant_id = ${c.tenantId}`
  await db()`delete from public.price_lists where tenant_id = ${c.tenantId}`
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

// ─────────────────────────────────────────────────────────────────────────
describe('El precio de la cotizacion', () => {
  it('vacio toma la lista del cliente para esa cantidad', async () => {
    const q = await nuevaCotizacion(colmado)
    expect(
      await agregarLinea(c.fd({ quoteId: q, productId: cemento, quantity: '40' }, 'Vendedor')),
    ).toEqual({
      ok: true,
    })
    expect(
      await agregarLinea(c.fd({ quoteId: q, productId: cemento, quantity: '5' }, 'Vendedor')),
    ).toEqual({
      ok: true,
    })
    const ls = await lineas(q)
    expect(ls.map((l) => Number(l.unit_price))).toEqual([425, 440])
  })

  it('sin cliente, el del catalogo; escrito a mano, el escrito', async () => {
    const q = await nuevaCotizacion(null)
    await agregarLinea(c.fd({ quoteId: q, productId: cemento, quantity: '2' }, 'Vendedor'))
    await agregarLinea(
      c.fd({ quoteId: q, productId: cemento, quantity: '2', unitPrice: '400' }, 'Vendedor'),
    )
    expect((await lineas(q)).map((l) => Number(l.unit_price))).toEqual([400, 465])
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Lo enviado no se cambia', () => {
  it('no se envia vacia', async () => {
    const q = await nuevaCotizacion(colmado)
    const r = await transicionarCotizacion(c.fd({ quoteId: q, siguiente: 'sent' }, 'Vendedor'))
    expect(r.ok).toBe(false)
  })

  it('enviada, no se le agregan ni quitan lineas', async () => {
    const q = await nuevaCotizacion(colmado)
    await agregarLinea(c.fd({ quoteId: q, productId: cemento, quantity: '10' }, 'Vendedor'))
    expect(
      await transicionarCotizacion(c.fd({ quoteId: q, siguiente: 'sent' }, 'Vendedor')),
    ).toEqual({
      ok: true,
    })
    const mas = await agregarLinea(
      c.fd({ quoteId: q, productId: cemento, quantity: '1' }, 'Vendedor'),
    )
    expect(mas.ok).toBe(false)
    if (mas.ok) return
    expect(mas.error).toMatch(/version nueva/)

    const [l] = await db()<
      { id: string }[]
    >`select id from public.quote_lines where quote_id = ${q}`
    expect((await quitarLinea(c.fd({ quoteId: q, lineId: l!.id }, 'Vendedor'))).ok).toBe(false)
    expect(await lineas(q)).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Convertir en pedido', () => {
  it('la aprobada se vuelve un pedido en borrador con los precios cotizados, una sola vez', async () => {
    const q = await nuevaCotizacion(colmado)
    await agregarLinea(c.fd({ quoteId: q, productId: cemento, quantity: '40' }, 'Vendedor'))

    // Enviada todavia no se convierte.
    await transicionarCotizacion(c.fd({ quoteId: q, siguiente: 'sent' }, 'Vendedor'))
    expect((await convertirEnPedido(c.fd({ quoteId: q }, 'Vendedor'))).ok).toBe(false)

    await transicionarCotizacion(c.fd({ quoteId: q, siguiente: 'approved' }, 'Vendedor'))

    // La lista cambia DESPUES de aprobada: el pedido respeta lo aceptado.
    await db()`
      update public.price_list_entries set unit_price = 999
      where tenant_id = ${c.tenantId} and product_id = ${cemento}`

    const r = await convertirEnPedido(c.fd({ quoteId: q, warehouseId: wh }, 'Vendedor'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [o] = await db()<{ status: string; total: string; customer_id: string; notes: string }[]>`
      select status, total::text, customer_id, notes from public.sales_orders where id = ${r.orderId!}`
    expect(o!.status).toBe('draft')
    expect(o!.customer_id).toBe(colmado)
    expect(Number(o!.total)).toBe(20060) // 40 x 425 + 18%
    expect(o!.notes).toMatch(/COT-/)
    const [l] = await db()<{ unit_price: string; qty_ordered: string; line_total: string }[]>`
      select unit_price::text, qty_ordered::text, line_total::text
      from public.sales_order_lines where order_id = ${r.orderId!}`
    expect(Number(l!.unit_price)).toBe(425)
    expect(Number(l!.qty_ordered)).toBe(40)
    expect(Number(l!.line_total)).toBe(20060)

    const [qq] = await db()<{ sales_order_id: string }[]>`
      select sales_order_id from public.quotes where id = ${q}`
    expect(qq!.sales_order_id).toBe(r.orderId)

    // Una segunda vez no saca otro pedido.
    const otra = await convertirEnPedido(c.fd({ quoteId: q }, 'Vendedor'))
    expect(otra.ok).toBe(false)
    const [n] = await db()<{ n: number }[]>`
      select count(*)::int as n from public.sales_orders where tenant_id = ${c.tenantId}`
    expect(n!.n).toBe(1)

    // Y ya convertida no se revisa: los cambios se hacen en el pedido.
    expect((await crearVersionNueva(c.fd({ quoteId: q }, 'Vendedor'))).ok).toBe(false)
  })

  it('sin permiso de crear pedidos, no se convierte', async () => {
    const q = await nuevaCotizacion(colmado)
    await agregarLinea(
      c.fd({ quoteId: q, productId: cemento, quantity: '1', unitPrice: '440' }, 'Vendedor'),
    )
    await transicionarCotizacion(c.fd({ quoteId: q, siguiente: 'sent' }, 'Vendedor'))
    await transicionarCotizacion(c.fd({ quoteId: q, siguiente: 'approved' }, 'Vendedor'))
    expect((await convertirEnPedido(c.fd({ quoteId: q }, 'SoloCotiza'))).ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Numeracion', () => {
  it('una version nueva no hace saltar el numero de la siguiente cotizacion', async () => {
    const a = await nuevaCotizacion(colmado)
    await agregarLinea(c.fd({ quoteId: a, productId: cemento, quantity: '1' }, 'Vendedor'))
    await transicionarCotizacion(c.fd({ quoteId: a, siguiente: 'sent' }, 'Vendedor'))
    expect(await crearVersionNueva(c.fd({ quoteId: a }, 'Vendedor'))).toEqual({ ok: true })

    const [ultimo] = await db()<{ n: number }[]>`
      select max(substring(quote_number from 'COT-(\\d+)')::int) as n
      from public.quotes where tenant_id = ${c.tenantId}`
    const r = await crearCotizacion(c.fd({ customerId: colmado }, 'Vendedor'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.number).toBe(`COT-${String(ultimo!.n + 1).padStart(4, '0')}`)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Pantallas de la cotizacion', () => {
  it('la aprobada ofrece imprimir y convertir en pedido; la impresion lleva lineas y total', async () => {
    const q = await nuevaCotizacion(colmado)
    await agregarLinea(
      c.fd({ quoteId: q, productId: cemento, quantity: '2', unitPrice: '440' }, 'Vendedor'),
    )
    await transicionarCotizacion(c.fd({ quoteId: q, siguiente: 'sent' }, 'Vendedor'))
    await transicionarCotizacion(c.fd({ quoteId: q, siguiente: 'approved' }, 'Vendedor'))

    const html = await pintar(import('./[id]/page'), q)
    expect(html).toContain('Convertir en pedido')
    expect(html).toContain(`/cotizaciones-venta/${q}/imprimir`)

    const papel = await pintar(import('./[id]/imprimir/page'), q)
    expect(papel).toContain('Colmado La Bendicion SRL')
    expect(papel).toContain('Producto CEM-100')
    expect(papel).toContain('1,038.40') // 2 x 440 + 18%
    expect(papel).toContain('no es un comprobante fiscal')
  })
})
