import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Productos sin control de existencias (0100) contra Postgres real.
 *
 * Un concepto vendible -envio, instalacion, mano de obra- se factura como
 * cualquier producto pero no tiene existencias. Lo que se prueba aqui es
 * la invariante que sostiene el diseno: NADA puede moverle inventario.
 *
 * Importa que este en la base y no solo en las acciones: el dia que
 * alguien agregue un camino nuevo -una devolucion, un ajuste, una
 * importacion- las existencias fantasma de un envio volverian por ahi.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
let tenant: string
let almacen: string
let envio: string
let cemento: string

beforeAll(async () => {
  const [t] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`sinstock-${RUN}`}, 'Sin Stock SRL', 'pyme', 'active') returning id`
  tenant = t!.id

  await sql`
    insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
    values (${tenant}, 'products', 'active', true), (${tenant}, 'inventory', 'active', true)
    on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`

  const [w] = await sql`
    insert into public.warehouses (tenant_id, name, is_default)
    values (${tenant}, 'Almacen Unico', true) returning id`
  almacen = w!.id

  const [e] = await sql`
    insert into public.products (tenant_id, sku, name, unit, price, tracks_stock)
    values (${tenant}, 'ENVIO', 'Envio a domicilio', 'servicio', 350, false) returning id`
  envio = e!.id

  const [c] = await sql`
    insert into public.products (tenant_id, sku, name, unit, price)
    values (${tenant}, ${`CEM-${RUN}`}, 'Cemento gris', 'saco', 465) returning id`
  cemento = c!.id
})

afterAll(async () => {
  await sql`delete from public.inventory_movements where tenant_id = ${tenant}`
  await sql`delete from public.stock_levels where tenant_id = ${tenant}`
  await sql`delete from public.products where tenant_id = ${tenant}`
  await sql`delete from public.warehouses where tenant_id = ${tenant}`
  await sql`delete from audit.log where tenant_id = ${tenant}`
  await sql`delete from regb.tenants where id = ${tenant}`
  await sql.end()
})

describe('Nada puede moverle inventario a un concepto sin existencias', () => {
  it('un movimiento de venta se rechaza', async () => {
    await expect(
      sql`insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty)
          values (${tenant}, ${almacen}, ${envio}, 'sale', -1)`,
    ).rejects.toThrow(/no lleva control de existencias/)
  })

  it('un ajuste de entrada tampoco -el camino que usa una anulacion-', async () => {
    await expect(
      sql`insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty)
          values (${tenant}, ${almacen}, ${envio}, 'adjustment_in', 5)`,
    ).rejects.toThrow(/no lleva control de existencias/)
  })

  it('una reserva tampoco', async () => {
    await expect(
      sql`insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty)
          values (${tenant}, ${almacen}, ${envio}, 'reservation', 2)`,
    ).rejects.toThrow(/no lleva control de existencias/)
  })

  it('no se le puede crear una fila de existencias a mano', async () => {
    await expect(
      sql`insert into public.stock_levels (tenant_id, warehouse_id, product_id, qty_on_hand)
          values (${tenant}, ${almacen}, ${envio}, 10)`,
    ).rejects.toThrow(/no lleva control de existencias/)
  })

  it('un producto normal si mueve inventario, como siempre', async () => {
    await sql`insert into public.inventory_movements
                (tenant_id, warehouse_id, product_id, movement_type, qty)
              values (${tenant}, ${almacen}, ${cemento}, 'adjustment_in', 20)`
    const [n] = await sql<{ qty_on_hand: string }[]>`
      select qty_on_hand::text from public.stock_levels
      where tenant_id = ${tenant} and product_id = ${cemento}`
    expect(Number(n!.qty_on_hand)).toBe(20)
  })
})

describe('No se le quita el control a algo que ya tiene historia', () => {
  it('un producto con movimientos no se puede pasar a sin existencias', async () => {
    await expect(
      sql`update public.products set tracks_stock = false where id = ${cemento}`,
    ).rejects.toThrow(/ya tiene movimientos de inventario/)
  })

  it('encender el control de un concepto si se permite -es el camino seguro-', async () => {
    const [p] = await sql`
      insert into public.products (tenant_id, sku, name, unit, price, tracks_stock)
      values (${tenant}, ${`SERV-${RUN}`}, 'Instalacion', 'servicio', 900, false) returning id`
    await sql`update public.products set tracks_stock = true where id = ${p!.id}`
    const [v] = await sql<{ tracks_stock: boolean }[]>`
      select tracks_stock from public.products where id = ${p!.id}`
    expect(v!.tracks_stock).toBe(true)
  })
})

describe('Un concepto sin existencias es un producto normal en todo lo demas', () => {
  it('tiene codigo, precio e ITBIS como cualquiera', async () => {
    const [p] = await sql<{ sku: string; price: string; tax_rate: string }[]>`
      select sku, price::text, tax_rate::text from public.products where id = ${envio}`
    expect(p!.sku).toBe('ENVIO')
    expect(Number(p!.price)).toBe(350)
    expect(Number(p!.tax_rate)).toBe(0.18)
  })

  it('no aparece en existencias porque no tiene ninguna', async () => {
    const filas = await sql`
      select 1 from public.stock_levels where tenant_id = ${tenant} and product_id = ${envio}`
    expect(filas).toHaveLength(0)
  })
})
