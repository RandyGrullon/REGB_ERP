import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { cerrarBase, sembrarCliente, type ClientePrueba } from '@/test/arnes'
import { crearProducto, editarProducto } from './actions'

/**
 * crearProducto() y editarProducto() llamadas DE VERDAD: dejan
 * `products.item.created` y `products.price.changed` en el outbox, en la
 * misma transaccion que el cambio.
 *
 * El manifiesto de `products` los declaraba desde F4 y ningun codigo los
 * emitia: una automatizacion "avisame cuando cambie un precio" se
 * guardaba y no sonaba nunca.
 */

let c: ClientePrueba

async function eventos(tipo: string) {
  return db()<{ payload: Record<string, unknown>; emitted_by: string }[]>`
    select payload, emitted_by from public.event_outbox
    where tenant_id = ${c.tenantId} and type = ${tipo}
    order by id`
}

async function idDe(sku: string) {
  const [p] = await db()<{ id: string }[]>`
    select id from public.products where tenant_id = ${c.tenantId} and sku = ${sku}`
  return p!.id
}

beforeAll(async () => {
  c = await sembrarCliente({
    prefijo: 'accion-products',
    nombre: 'Eventos Productos SRL',
    modulos: ['products'],
    roles: {
      Administrador: { 'products.*': true },
      // Edita la ficha pero no el precio: su guardado no es un cambio de precio.
      Vendedor: { 'products.view': true, 'products.edit': true },
    },
  })
})

afterAll(async () => {
  await c.limpiar(['public.products'])
  await cerrarBase()
})

describe('crearProducto emite products.item.created', () => {
  it('un producto nuevo deja un solo evento, con su id y nada mas', async () => {
    const r = await crearProducto(c.fd({ sku: 'EV-001', name: 'Cemento de prueba', price: '465' }))
    expect(r).toEqual({ ok: true })

    const ev = await eventos('products.item.created')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.emitted_by).toBe('products')
    expect(ev[0]!.payload).toEqual({ productId: await idDe('EV-001') })
  })

  it('un SKU repetido no crea producto ni evento', async () => {
    const r = await crearProducto(c.fd({ sku: 'EV-001', name: 'Otro cemento', price: '1' }))
    expect(r.ok).toBe(false)
    expect(await eventos('products.item.created')).toHaveLength(1)
  })
})

describe('editarProducto emite products.price.changed solo si el precio cambia', () => {
  it('cambiar el precio deja el evento con el antes y el despues', async () => {
    const id = await idDe('EV-001')
    const r = await editarProducto(
      c.fd({ id, name: 'Cemento de prueba', price: '480', cost: '400' }),
    )
    expect(r).toEqual({ ok: true })

    const ev = await eventos('products.price.changed')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.payload).toEqual({ productId: id, oldPrice: 465, newPrice: 480 })
  })

  it('guardar la ficha con el mismo precio no es un cambio de precio', async () => {
    const id = await idDe('EV-001')
    const r = await editarProducto(
      c.fd({ id, name: 'Cemento gris de prueba', price: '480', cost: '400' }),
    )
    expect(r).toEqual({ ok: true })
    expect(await eventos('products.price.changed')).toHaveLength(1)
  })

  it('un rol sin products.price.edit edita la ficha sin tocar ni anunciar el precio', async () => {
    const id = await idDe('EV-001')
    const r = await editarProducto(
      c.fd({ id, name: 'Cemento renombrado', price: '1', cost: '1' }, 'Vendedor'),
    )
    expect(r).toEqual({ ok: true })

    const [p] = await db()<{ price: string }[]>`
      select price::text from public.products where id = ${id}`
    expect(Number(p!.price)).toBe(480)
    expect(await eventos('products.price.changed')).toHaveLength(1)
  })
})
