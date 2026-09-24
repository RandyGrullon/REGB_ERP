import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { almacen, limpiarCredito, producto } from '@/test/venta-a-credito'
import { crearEntrada, quitarEntrada } from './actions'

/**
 * Cuotas de una lista de precios (cliente misterioso, 23 sep 2026).
 *
 * Una cuota con un precio mal escrito no tenia arreglo: no se podia editar
 * ni quitar, y volver a registrarla daba el error crudo del indice unico
 * ("duplicate key value violates unique constraint ..."). Ahora
 * registrarla otra vez le corrige el precio, y se puede quitar.
 */

const DUENO = { '*': true }
const VENDEDOR = { 'price-lists.view': true, 'products.view': true }

let c: ClientePrueba
let lista: string
let prod: string

async function cuotas() {
  return db()<{ id: string; min_quantity: string; unit_price: string }[]>`
    select id, min_quantity::text, unit_price::text from public.price_list_entries
    where price_list_id = ${lista} order by min_quantity`
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-listas',
    modulos: ['products', 'inventory', 'price-lists'],
    roles: { Dueno: DUENO, Vendedor: VENDEDOR },
  })
  const wh = await almacen(c.tenantId)
  prod = await producto(c.tenantId, wh, { sku: 'CEM-100', precio: 465 })
  const [l] = await db()<{ id: string }[]>`
    insert into public.price_lists (tenant_id, name, scope, start_date)
    values (${c.tenantId}, 'Mayorista', 'general', current_date) returning id`
  lista = l!.id
})

afterAll(async () => {
  await db()`delete from public.price_list_entries where tenant_id = ${c.tenantId}`
  await db()`delete from public.price_lists where tenant_id = ${c.tenantId}`
  await limpiarCredito(c.limpiar)
  await cerrarBase()
})

describe('Cuotas de precio', () => {
  it('registrar otra vez la misma cuota le corrige el precio, sin error crudo', async () => {
    expect(
      await crearEntrada(
        c.fd({ listId: lista, productId: prod, minQuantity: '20', unitPrice: '42.50' }, 'Dueno'),
      ),
    ).toEqual({ ok: true, actualizada: false })

    const otra = await crearEntrada(
      c.fd({ listId: lista, productId: prod, minQuantity: '20', unitPrice: '425' }, 'Dueno'),
    )
    expect(otra).toEqual({ ok: true, actualizada: true })

    const cs = await cuotas()
    expect(cs).toHaveLength(1)
    expect(Number(cs[0]!.unit_price)).toBe(425)
  })

  it('una cuota se quita', async () => {
    await crearEntrada(
      c.fd({ listId: lista, productId: prod, minQuantity: '1', unitPrice: '440' }, 'Dueno'),
    )
    const antes = await cuotas()
    const uno = antes.find((x) => Number(x.min_quantity) === 1)!
    expect(await quitarEntrada(c.fd({ listId: lista, entryId: uno.id }, 'Dueno'))).toEqual({
      ok: true,
    })
    expect((await cuotas()).map((x) => Number(x.min_quantity))).toEqual([20])
  })

  it('quien solo ve las listas no las cambia', async () => {
    const [q] = await cuotas()
    expect((await quitarEntrada(c.fd({ listId: lista, entryId: q!.id }, 'Vendedor'))).ok).toBe(
      false,
    )
    expect(
      (
        await crearEntrada(
          c.fd({ listId: lista, productId: prod, minQuantity: '20', unitPrice: '1' }, 'Vendedor'),
        )
      ).ok,
    ).toBe(false)
    expect(Number((await cuotas())[0]!.unit_price)).toBe(425)
  })
})
