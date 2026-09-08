import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * E-commerce sync (modulo 36, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un vinculo/pedido/linea con el producto/canal
 *     de A usando su PROPIO tenant_id. Mismo patron que 0031-0087.
 *  3. Un pedido de canal es editable hasta resolverse (importado o
 *     cancelado, ambos terminales); una linea es inmutable desde el
 *     insert.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let productoA: string
let productoB: string
let canalA: string
let canalB: string

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function as<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function modulo(tenant: string, id: string, encendido: boolean) {
  await sql`
    update regb.tenant_modules set enabled = ${encendido}
    where tenant_id = ${tenant} and module_id = ${id}`
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ec-a-${RUN}`}, 'Ecommerce A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ec-b-${RUN}`}, 'Ecommerce B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'ecommerce', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name, price) values (${tenantA}, ${`SKU-A-${RUN}`}, 'Producto A', 100) returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name, price) values (${tenantB}, ${`SKU-B-${RUN}`}, 'Producto B', 100) returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [ca] = await sql`
    insert into public.sales_channels (tenant_id, name, platform) values (${tenantA}, 'Tienda A', 'shopify') returning id`
  const [cb] = await sql`
    insert into public.sales_channels (tenant_id, name, platform) values (${tenantB}, 'Tienda B', 'woocommerce') returning id`
  canalA = ca!.id
  canalB = cb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.channel_order_lines disable trigger no_editar_linea_pedido_canal')
  await sql`delete from public.channel_order_lines where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.channel_order_lines enable trigger no_editar_linea_pedido_canal')
  await sql.unsafe('alter table public.channel_orders disable trigger no_editar_pedido_canal_resuelto')
  await sql`delete from public.channel_orders where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.channel_orders enable trigger no_editar_pedido_canal_resuelto')
  await sql`delete from public.channel_product_links where tenant_id in ${sql(ts)}`
  await sql`delete from public.sales_channels where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio canal normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.sales_channels`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el canal de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.sales_channels where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un vinculo con el producto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.channel_product_links (tenant_id, channel_id, product_id, external_sku)
          values (${tenantB}, ${canalB}, ${productoA}, 'x')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un pedido con el canal de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, total)
          values (${tenantB}, ${canalA}, 'EXT-1', 'x', 100)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una linea con el pedido de A usando su PROPIO tenant_id', async () => {
    const [pedidoA] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, total)
        values (${tenantA}, ${canalA}, 'EXT-A-1', 'Cliente A', 100) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.channel_order_lines (tenant_id, order_id, external_sku, quantity, unit_price)
          values (${tenantB}, ${pedidoA!.id}, 'x', 1, 100)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una linea con el producto de A usando su PROPIO tenant_id', async () => {
    const [pedidoB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, total)
        values (${tenantB}, ${canalB}, 'EXT-B-1', 'Cliente B', 100) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.channel_order_lines (tenant_id, order_id, product_id, external_sku, quantity, unit_price)
          values (${tenantB}, ${pedidoB!.id}, ${productoA}, 'x', 1, 100)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Pedido editable hasta resolverse; linea inmutable desde el insert', () => {
  let pedido: string

  it('recibido, el total y el estado son editables', async () => {
    const [p] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, total)
        values (${tenantB}, ${canalB}, 'EXT-B-2', 'Cliente B2', 250) returning id`,
    )
    pedido = p!.id
    await as(userB, tenantB, (tx) => tx`update public.channel_orders set total = 300 where id = ${pedido}`)
    const [row] = await sql`select total::text from public.channel_orders where id = ${pedido}`
    expect(row!.total).toBe('300.00')
  })

  it('una linea se registra normalmente pero nunca se puede editar', async () => {
    const [l] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.channel_order_lines (tenant_id, order_id, product_id, external_sku, quantity, unit_price)
        values (${tenantB}, ${pedido}, ${productoB}, ${`SKU-B-${RUN}`}, 2, 100) returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.channel_order_lines set quantity = 5 where id = ${l!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('marcarlo importado lo congela', async () => {
    await as(userB, tenantB, (tx) => tx`update public.channel_orders set status = 'imported', resolved_at = now() where id = ${pedido}`)
    await expect(
      as(userB, tenantB, (tx) => tx`update public.channel_orders set total = 999 where id = ${pedido}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'ecommerce', true))

  it('sin el modulo, los canales dan cero filas', async () => {
    await modulo(tenantB, 'ecommerce', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.sales_channels`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una plataforma inventada se rechaza', async () => {
    await expect(
      sql`insert into public.sales_channels (tenant_id, name, platform) values (${tenantA}, 'x', 'magento')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo external_order_id no se repite dentro del mismo canal', async () => {
    await sql.unsafe('alter table public.channel_orders disable trigger no_editar_pedido_canal_resuelto')
    await expect(
      sql`insert into public.channel_orders (tenant_id, channel_id, external_order_id, customer_name, total)
        values (${tenantA}, ${canalA}, 'EXT-A-1', 'Cliente A', 100)`,
    ).rejects.toThrow(/duplicate key/)
    await sql.unsafe('alter table public.channel_orders enable trigger no_editar_pedido_canal_resuelto')
  })
})
