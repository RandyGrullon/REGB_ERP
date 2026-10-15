import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { asUser, db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { limpiarCredito, producto } from '@/test/venta-a-credito'
import { Widget, cargarDatosWidgets } from './widgets'

/**
 * "Bajo el punto de reorden" (grabación de la demo, 15 oct 2026).
 *
 * El punto de reorden es del producto y la existencia es por almacén: el
 * mismo producto bajo en dos almacenes salía dos veces con el mismo nombre
 * y el mismo SKU, sin decir de dónde era cada fila.
 */

;(globalThis as { React?: typeof React }).React = React

/** El usuario del modo demostración (bootstrap.ts). */
const YO = '00000000-0000-0000-0000-000000000001'

let c: ClientePrueba

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-reorden',
    modulos: ['products', 'inventory'],
    roles: { Dueno: { '*': true } },
  })
  const almacenes = await db()<{ id: string; name: string }[]>`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${c.tenantId}, 'Almacén Principal', 'PRI', true),
           (${c.tenantId}, 'Sucursal Santiago', 'STI', false)
    returning id, name`
  const principal = almacenes.find((a) => a.name === 'Almacén Principal')!.id
  const santiago = almacenes.find((a) => a.name === 'Sucursal Santiago')!.id
  const cemento = await producto(c.tenantId, principal, {
    sku: 'CEM-425',
    precio: 650,
    existencia: 4,
  })
  await db()`
    insert into public.inventory_movements
      (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, reason)
    values (${c.tenantId}, ${santiago}, ${cemento}, 'receipt', 7, 390, 'Existencia inicial de prueba')`
  await db()`update public.products set reorder_point = 10 where id = ${cemento}`
})

afterAll(async () => {
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

describe('Bajo el punto de reorden', () => {
  it('dice el almacén de cada fila', async () => {
    const datos = await asUser(YO, c.tenantId, (tx) =>
      cargarDatosWidgets(tx, c.tenantId, ['stock-alerts'], false),
    )
    expect(datos.stockBajo).toEqual([
      { name: 'Producto CEM-425', sku: 'CEM-425', almacen: 'Almacén Principal', qty: 4, punto: 10 },
      { name: 'Producto CEM-425', sku: 'CEM-425', almacen: 'Sucursal Santiago', qty: 7, punto: 10 },
    ])

    const html = renderToStaticMarkup(
      createElement(Widget, { clave: 'stock-alerts', datos, qs: '' }),
    )
    expect(html).toContain('CEM-425 · Almacén Principal')
    expect(html).toContain('CEM-425 · Sucursal Santiago')
  })
})
