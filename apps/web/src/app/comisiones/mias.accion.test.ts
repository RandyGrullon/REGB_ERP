import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { almacen, cliente, limpiarCredito, pedido, producto } from '@/test/venta-a-credito'

/**
 * Mis comisiones (revisión de pantallas, 30 sep 2026).
 *
 * El Vendedor de fábrica trae `commissions.view.own`, pero /comisiones pide
 * `commissions.view` y al vendedor le salía "No encontramos esta
 * pantalla": no tenía cómo ver lo que le toca. /comisiones/mias le enseña
 * SOLO las suyas, con lo que falta por aprobar y por cobrar. La lista del
 * encargado ahora dice el cliente de cada pedido y cuánto hay por pagar.
 */

;(globalThis as { React?: typeof React }).React = React

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect(${url})`)
  },
  notFound: () => {
    throw new Error('notFound()')
  },
  usePathname: () => '/comisiones',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

type Pagina = (p: {
  params?: Promise<Record<string, string>>
  searchParams: Promise<Record<string, string>>
}) => Promise<ReactElement>

/** El usuario del modo demostración (bootstrap.ts). */
const YO = '00000000-0000-0000-0000-000000000001'
const OTRO = '00000000-0000-0000-0000-0000000000aa'

let c: ClientePrueba

async function pintar(modulo: Promise<{ default: unknown }>, rol: string): Promise<string> {
  const Page = (await modulo).default as Pagina
  const el = await Page({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({ tenant: c.slug, rol }),
  })
  return renderToStaticMarkup(createElement(() => el))
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-comisiones',
    modulos: ['products', 'inventory', 'sales-orders', 'commissions'],
    roles: {
      Dueno: { '*': true },
      Vendedor: { 'commissions.view.own': true, 'sales-orders.view': true },
      Gerente: { '*.view': true },
    },
  })
  const wh = await almacen(c.tenantId)
  const prod = await producto(c.tenantId, wh, { sku: 'PIN-300', precio: 1150 })
  const hotel = await cliente(c.tenantId, { nombre: 'Hotel Costa Azul SRL' })
  const colmado = await cliente(c.tenantId, { nombre: 'Colmado La Fe' })
  const mio = await pedido(c.tenantId, {
    customerId: hotel,
    warehouseId: wh,
    productId: prod,
    cantidad: 10,
    precio: 1150,
    estado: 'confirmed',
  })
  const ajeno = await pedido(c.tenantId, {
    customerId: colmado,
    warehouseId: wh,
    productId: prod,
    cantidad: 2,
    precio: 1150,
    estado: 'confirmed',
  })
  const [plan] = await db()<{ id: string }[]>`
    insert into public.commission_plans (tenant_id, name, basis, rate)
    values (${c.tenantId}, 'Plan de mostrador', 'percentage', 0.05) returning id`
  await db()`
    insert into public.commission_entries
      (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount, status)
    values (${c.tenantId}, ${plan!.id}, ${mio}, ${YO}, 11500, 575, 'pending'),
           (${c.tenantId}, ${plan!.id}, ${ajeno}, ${OTRO}, 2300, 115, 'approved')`
})

afterAll(async () => {
  await db()`delete from public.commission_entries where tenant_id = ${c.tenantId}`
  await db()`delete from public.commission_plans where tenant_id = ${c.tenantId}`
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

describe('Mis comisiones', () => {
  it('el vendedor ve las suyas, con el cliente y lo que falta por aprobar', async () => {
    const html = await pintar(import('./mias/page'), 'Vendedor')
    expect(html).toContain('Mis comisiones')
    expect(html).toContain('Hotel Costa Azul SRL')
    expect(html).toContain('RD$ 575.00')
    // La de otro vendedor no se ve.
    expect(html).not.toContain('Colmado La Fe')
    expect(html).not.toContain('115.00')
  })

  it('la lista de todas sigue cerrada para el vendedor', async () => {
    await expect(pintar(import('./page'), 'Vendedor')).rejects.toThrow('notFound()')
  })

  it('quien ve todas lee el cliente de cada pedido y cuánto hay por pagar', async () => {
    const html = await pintar(import('./page'), 'Gerente')
    expect(html).toContain('Hotel Costa Azul SRL')
    expect(html).toContain('Colmado La Fe')
    expect(html).toContain('Aprobadas por pagar')
    expect(html).toContain('RD$ 115.00')
    // Sin `commissions.manage` no se le ofrece un enlace a los planes que
    // le daría "No encontramos esta pantalla".
    expect(html).not.toContain('/comisiones/planes')
  })
})
