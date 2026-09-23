import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import {
  MODULOS_CREDITO,
  almacen,
  cliente,
  factura,
  limpiarCredito,
  mora,
  pedido,
  producto,
  secuencia,
} from '@/test/venta-a-credito'
import { facturarPedido, registrarCobro } from './actions'

/**
 * Las pantallas de credito se pintan de verdad (render en servidor) con
 * datos reales: la del pedido bloqueado, la ficha del cliente, "sin
 * facturar", la factura con sus lineas, cobros reversables y notas, la
 * vista imprimible y la politica en la cartera.
 *
 * No es una prueba visual: comprueba que cada pantalla compila, consulta
 * y DICE lo que tiene que decir. Lo visual se revisa en el navegador.
 */

// Next compila el JSX con el runtime automatico; vitest (esbuild) lo deja en
// el clasico, que llama a `React.createElement` como global.
;(globalThis as { React?: typeof React }).React = React

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect(${url})`)
  },
  notFound: () => {
    throw new Error('notFound()')
  },
  usePathname: () => '/cobrar',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

type Pagina = (p: {
  params?: Promise<Record<string, string>>
  searchParams: Promise<Record<string, string>>
}) => Promise<ReactElement>

let c: ClientePrueba
let martillo: string
let pedidoBloqueado: string
let facturaId: string

async function pintar(
  modulo: Promise<{ default: unknown }>,
  params: Record<string, string> = {},
  rol = 'Dueno',
): Promise<string> {
  const Page = (await modulo).default as Pagina
  const el = await Page({
    params: Promise.resolve(params),
    searchParams: Promise.resolve({ tenant: c.slug, rol }),
  })
  return renderToStaticMarkup(createElement(() => el))
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-pantallas',
    nombre: 'Tienda Pantallas SRL',
    modulos: MODULOS_CREDITO,
    roles: {
      Dueno: { '*': true },
      Vendedor: { 'sales-orders.*': true, 'ar.view': true, 'products.view': true },
    },
  })
  const wh = await almacen(c.tenantId)
  const prod = await producto(c.tenantId, wh, { sku: 'TV-65', precio: 1000, existencia: 100 })
  await secuencia(c.tenantId, 'B02')

  martillo = await cliente(c.tenantId, {
    nombre: 'Ferreteria El Martillo SRL',
    rnc: '131223345',
    limite: 50000,
  })
  const vieja = await factura(c.tenantId, martillo, { numero: 'FAC-DEMO-0003', total: 11564, diasVencida: 96 })
  await mora(c.tenantId, vieja, 500, 96)
  pedidoBloqueado = await pedido(c.tenantId, {
    customerId: martillo,
    warehouseId: wh,
    productId: prod,
    cantidad: 3,
    precio: 1000,
    estado: 'draft',
  })

  // Una factura con lineas, un cobro y su reverso.
  const alDia = await cliente(c.tenantId, { nombre: 'Cliente Al Dia SRL' })
  const entregado = await pedido(c.tenantId, {
    customerId: alDia,
    warehouseId: wh,
    productId: prod,
    cantidad: 2,
    precio: 1000,
    estado: 'delivered',
  })
  expect(await facturarPedido(c.fd({ orderId: entregado, ncfType: 'B02' }, 'Dueno'))).toEqual({
    ok: true,
  })
  const [f] = await db()<{ id: string }[]>`
    select id from public.customer_invoices where source_id = ${entregado}`
  facturaId = f!.id
  await registrarCobro(c.fd({ invoiceId: facturaId, amount: '500', method: 'cash' }, 'Dueno'))
  const { reversarCobro } = await import('./actions')
  const [p] = await db()<{ id: string }[]>`
    select id from public.customer_payments where invoice_id = ${facturaId}`
  await reversarCobro(c.fd({ paymentId: p!.id, reason: 'Se registro dos veces' }, 'Dueno'))

  // Uno entregado sin facturar del moroso, para la lista de Por cobrar.
  await pedido(c.tenantId, {
    customerId: martillo,
    warehouseId: wh,
    productId: prod,
    cantidad: 1,
    precio: 1000,
    estado: 'delivered',
  })
})

afterAll(async () => {
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

describe('Pantallas de venta a credito', () => {
  it('el pedido bloqueado dice por que y ofrece la excepcion al dueno, no el boton de confirmar', async () => {
    const html = await pintar(import('../pedidos/[id]/page'), { id: pedidoBloqueado })
    expect(html).toContain('Credito bloqueado')
    expect(html).toContain('96 dias')
    expect(html).toContain('Confirmar con excepcion')
    expect(html).not.toContain('Confirmar y apartar')
  })

  it('al vendedor no le ofrece la excepcion: le dice quien puede', async () => {
    const html = await pintar(import('../pedidos/[id]/page'), { id: pedidoBloqueado }, 'Vendedor')
    expect(html).toContain('Credito bloqueado')
    expect(html).not.toContain('Confirmar con excepcion')
    expect(html).toContain('ar.credit.override')
  })

  it('la ficha del cliente: RNC invalido, limite, saldo y el formulario para corregirlo', async () => {
    const html = await pintar(import('../pedidos/clientes/[id]/page'), { id: martillo })
    expect(html).toContain('RNC invalido')
    expect(html).toContain('Limite de credito')
    expect(html).toContain('FAC-DEMO-0003')
    expect(html).toContain('Guardar cambios')
  })

  it('la lista de clientes enlaza a la ficha y muestra el limite', async () => {
    const html = await pintar(import('../pedidos/clientes/page'))
    expect(html).toContain(`/pedidos/clientes/${martillo}`)
    expect(html).toContain('50,000.00')
  })

  it('Por cobrar: lo entregado sin facturar, con comprobante a elegir y el bloqueo a la vista', async () => {
    const html = await pintar(import('./page'))
    expect(html).toContain('Pedidos entregados sin facturar')
    expect(html).toContain('Consumo (B02)')
    expect(html).toContain('131-22334-5')
    expect(html).toContain('Facturar con excepcion')
  })

  it('la factura: lineas, cobro reversado tachado con su motivo, notas y enlace para imprimir', async () => {
    const html = await pintar(import('./[id]/page'), { id: facturaId })
    expect(html).toContain('Producto TV-65')
    expect(html).toContain('Se registro dos veces')
    expect(html).toContain('line-through')
    expect(html).toContain('Notas de credito')
    expect(html).toContain(`/cobrar/${facturaId}/imprimir`)
  })

  it('la vista imprimible lleva NCF, tipo de comprobante y el detalle', async () => {
    const html = await pintar(import('./[id]/imprimir/page'), { id: facturaId })
    expect(html).toMatch(/NCF: B02\d{8}/)
    expect(html).toContain('Factura de consumo')
    expect(html).toContain('Valida hasta')
    expect(html).toContain('Producto TV-65')
    expect(html).toContain('Credito a 30 dias')
  })

  it('la cartera muestra la politica y deja cambiarla al dueno', async () => {
    const html = await pintar(import('./cartera/page'))
    expect(html).toContain('Politica de credito')
    expect(html).toContain('mas de 30 dias')
    expect(html).toContain('name="overdueDays"')
  })
})
