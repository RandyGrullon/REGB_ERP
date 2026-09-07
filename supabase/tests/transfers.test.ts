import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Transferencias (modulo 50, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una transferencia o una linea con referencias
 *     de A usando su PROPIO tenant_id. Mismo patron que 0031-0066.
 *  3. Una vez recibida, la linea es inmutable; una vez despachada, lo
 *     pedido ya no se puede cambiar -pero SI se puede seguir editando
 *     antes de despachar-.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let almacen1A: string
let almacen2A: string
let almacen1B: string
let almacen2B: string
let productoA: string
let productoB: string

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
    values (${`tr-a-${RUN}`}, 'Ferreteria TR A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`tr-b-${RUN}`}, 'Distribuidora TR B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'inventory', 'active', true), (${t}, 'transfers', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [w1a] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantA}, 'A1') returning id`
  const [w2a] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantA}, 'A2') returning id`
  const [w1b] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantB}, 'B1') returning id`
  const [w2b] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantB}, 'B2') returning id`
  almacen1A = w1a!.id
  almacen2A = w2a!.id
  almacen1B = w1b!.id
  almacen2B = w2b!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`SKU-A-${RUN}`}, 'Cemento') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`SKU-B-${RUN}`}, 'Varilla') returning id`
  productoA = pa!.id
  productoB = pb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.transfer_order_lines disable trigger no_editar_linea_transferencia_resuelta')
  await sql.unsafe('alter table public.transfer_order_lines disable trigger no_borrar_linea_transferencia_despachada')
  await sql`delete from public.transfer_order_lines where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.transfer_order_lines enable trigger no_editar_linea_transferencia_resuelta')
  await sql.unsafe('alter table public.transfer_order_lines enable trigger no_borrar_linea_transferencia_despachada')
  await sql`delete from public.transfer_orders where tenant_id in ${sql(ts)}`
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A crea su propia transferencia normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.transfer_orders (tenant_id, from_warehouse_id, to_warehouse_id)
        values (${tenantA}, ${almacen1A}, ${almacen2A})`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.transfer_orders`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la transferencia de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.transfer_orders where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una transferencia con el almacen de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.transfer_orders (tenant_id, from_warehouse_id, to_warehouse_id)
          values (${tenantB}, ${almacen1A}, ${almacen2B})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una linea con la orden o el producto de A usando su PROPIO tenant_id', async () => {
    const [ordenA] = await sql`select id from public.transfer_orders where tenant_id = ${tenantA}`
    const [ordenB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.transfer_orders (tenant_id, from_warehouse_id, to_warehouse_id)
        values (${tenantB}, ${almacen1B}, ${almacen2B}) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.transfer_order_lines (order_id, tenant_id, product_id, qty_requested)
          values (${ordenA!.id}, ${tenantB}, ${productoB}, 5)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.transfer_order_lines (order_id, tenant_id, product_id, qty_requested)
          values (${ordenB!.id}, ${tenantB}, ${productoA}, 5)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('no se puede transferir un almacen a si mismo', async () => {
    await expect(
      sql`
        insert into public.transfer_orders (tenant_id, from_warehouse_id, to_warehouse_id)
        values (${tenantA}, ${almacen1A}, ${almacen1A})`,
    ).rejects.toThrow(/violates check constraint/)
  })
})

describe('Una vez despachada, lo pedido no se puede cambiar; una vez recibida, la linea es fija', () => {
  let orden: string
  let linea: string

  it('se crea la transferencia con su linea en draft, editable', async () => {
    const [o] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.transfer_orders (tenant_id, from_warehouse_id, to_warehouse_id)
        values (${tenantB}, ${almacen1B}, ${almacen2B}) returning id`,
    )
    orden = o!.id
    const [l] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.transfer_order_lines (order_id, tenant_id, product_id, qty_requested)
        values (${orden}, ${tenantB}, ${productoB}, 10) returning id`,
    )
    linea = l!.id

    await as(
      userB,
      tenantB,
      (tx) => tx`update public.transfer_order_lines set qty_requested = 15 where id = ${linea}`,
    )
    const [row] = await sql`select qty_requested::text from public.transfer_order_lines where id = ${linea}`
    expect(row!.qty_requested).toBe('15.000')
  })

  it('al despachar (fijar qty_sent), lo pedido ya no se puede cambiar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.transfer_order_lines set qty_sent = 15 where id = ${linea}`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.transfer_order_lines set qty_requested = 20 where id = ${linea}`,
      ),
    ).rejects.toThrow(/ya fue despachada/)
  })

  it('despachada, ya no se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.transfer_order_lines where id = ${linea}`),
    ).rejects.toThrow(/ya fue despachada/)
  })

  it('al recibir (fijar qty_received), la linea entera queda fija', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.transfer_order_lines set qty_received = 14 where id = ${linea}`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.transfer_order_lines set qty_received = 15 where id = ${linea}`,
      ),
    ).rejects.toThrow(/ya fue recibida/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'transfers', true))

  it('sin el modulo, las transferencias dan cero filas', async () => {
    await modulo(tenantB, 'transfers', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.transfer_orders`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una cantidad pedida de cero o negativa se rechaza', async () => {
    const [o] = await sql`
      insert into public.transfer_orders (tenant_id, from_warehouse_id, to_warehouse_id)
      values (${tenantA}, ${almacen1A}, ${almacen2A}) returning id`
    await expect(
      sql`
        insert into public.transfer_order_lines (order_id, tenant_id, product_id, qty_requested)
        values (${o!.id}, ${tenantA}, ${productoA}, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un estado inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.transfer_orders (tenant_id, from_warehouse_id, to_warehouse_id, status)
        values (${tenantA}, ${almacen1A}, ${almacen2A}, 'en_camion')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
