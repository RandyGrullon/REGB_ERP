import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Listas de precios (modulo 41, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una lista con el cliente de A, ni una entrada
 *     con la lista o el producto de A, usando su PROPIO tenant_id.
 *     Mismo patron que 0031-0061.
 *  3. `customers.price_list_id` -una referencia nueva sobre una tabla
 *     que ya existia desde 0020- tambien queda protegida.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let clienteA: string
let clienteB: string
let productoA: string
let listaA: string

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
    values (${`pl-a-${RUN}`}, 'Ferreteria PL A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`pl-b-${RUN}`}, 'Distribuidora PL B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'price-lists', 'active', true), (${t}, 'sales-orders', 'active', true),
             (${t}, 'products', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.customers (tenant_id, name) values (${tenantA}, 'Cliente A') returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name) values (${tenantB}, 'Cliente B') returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name, price)
    values (${tenantA}, ${`SKU-${RUN}`}, 'Producto A', 100) returning id`
  productoA = pa!.id

  const [la] = await sql`
    insert into public.price_lists (tenant_id, name, scope) values (${tenantA}, 'General A', 'general') returning id`
  listaA = la!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`update public.customers set price_list_id = null where tenant_id in ${sql(ts)}`
  await sql`delete from public.price_list_entries where tenant_id in ${sql(ts)}`
  await sql`delete from public.price_lists where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia lista normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.price_lists where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la lista de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.price_lists where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una lista de cliente con el cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.price_lists (tenant_id, name, scope, customer_id)
          values (${tenantB}, 'x', 'customer', ${clienteA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una entrada con la lista de A usando su PROPIO tenant_id', async () => {
    const [productoB] = await sql`
      insert into public.products (tenant_id, sku, name, price)
      values (${tenantB}, ${`SKU-B-${RUN}`}, 'Producto B', 50) returning id`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.price_list_entries (tenant_id, price_list_id, product_id, unit_price)
          values (${tenantB}, ${listaA}, ${productoB!.id}, 90)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una entrada con el producto de A usando su PROPIO tenant_id', async () => {
    const [listaB] = await sql`
      insert into public.price_lists (tenant_id, name, scope) values (${tenantB}, 'General B', 'general') returning id`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.price_list_entries (tenant_id, price_list_id, product_id, unit_price)
          values (${tenantB}, ${listaB!.id}, ${productoA}, 90)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede asignar a su propio cliente la lista de precios de A', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.customers set price_list_id = ${listaA} where id = ${clienteB}`),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B SI puede asignar a su propio cliente su propia lista de precios', async () => {
    const [listaB] = await sql`select id from public.price_lists where tenant_id = ${tenantB} limit 1`
    await as(userB, tenantB, (tx) => tx`update public.customers set price_list_id = ${listaB!.id} where id = ${clienteB}`)
    const [row] = await sql`select price_list_id from public.customers where id = ${clienteB}`
    expect(row!.price_list_id).toBe(listaB!.id)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'price-lists', true))

  it('sin el modulo, las listas dan cero filas', async () => {
    await modulo(tenantB, 'price-lists', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.price_lists`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una lista de cliente sin customer_id se rechaza', async () => {
    await expect(
      sql`insert into public.price_lists (tenant_id, name, scope) values (${tenantA}, 'x', 'customer')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una lista de canal sin channel se rechaza', async () => {
    await expect(
      sql`insert into public.price_lists (tenant_id, name, scope) values (${tenantA}, 'x', 'channel')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una fecha de fin antes que la de inicio se rechaza', async () => {
    await expect(
      sql`
        insert into public.price_lists (tenant_id, name, scope, start_date, end_date)
        values (${tenantA}, 'x', 'general', current_date, current_date - 1)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una cuota de volumen duplicada para el mismo producto y lista no se repite', async () => {
    await sql`
      insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
      values (${tenantA}, ${listaA}, ${productoA}, 10, 90)`
    await expect(
      sql`
        insert into public.price_list_entries (tenant_id, price_list_id, product_id, min_quantity, unit_price)
        values (${tenantA}, ${listaA}, ${productoA}, 10, 85)`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})
