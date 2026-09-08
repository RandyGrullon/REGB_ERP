import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Piso de planta / OEE (modulo 60, F8.5) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una sesion o un paro con la orden de A usando
 *     su PROPIO tenant_id. Mismo patron que 0031-0076.
 *  3. Una sesion/paro abierto es editable; cerrado (clocked_out_at /
 *     ended_at) se congela.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let almacenA: string
let almacenB: string
let productoA: string
let productoB: string
let bomA: string
let bomB: string
let ordenA: string
let ordenB: string

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
    values (${`sf-a-${RUN}`}, 'Planta SF A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`sf-b-${RUN}`}, 'Planta SF B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'bom', 'active', true),
             (${t}, 'manufacturing', 'active', true), (${t}, 'shopfloor', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [wa] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantA}, 'Planta A') returning id`
  const [wb] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantB}, 'Planta B') returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  const [pa] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantA}, ${`PZA-A-${RUN}`}, 'Pieza A') returning id`
  const [pb] = await sql`
    insert into public.products (tenant_id, sku, name) values (${tenantB}, ${`PZA-B-${RUN}`}, 'Pieza B') returning id`
  productoA = pa!.id
  productoB = pb!.id

  const [ba] = await sql`
    insert into public.bill_of_materials (tenant_id, product_id, version, status)
    values (${tenantA}, ${productoA}, 1, 'active') returning id`
  const [bb] = await sql`
    insert into public.bill_of_materials (tenant_id, product_id, version, status)
    values (${tenantB}, ${productoB}, 1, 'active') returning id`
  bomA = ba!.id
  bomB = bb!.id

  const [oa] = await sql`
    insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
    values (${tenantA}, ${bomA}, ${almacenA}, 10) returning id`
  const [ob] = await sql`
    insert into public.production_orders (tenant_id, bom_id, warehouse_id, qty_planned)
    values (${tenantB}, ${bomB}, ${almacenB}, 10) returning id`
  ordenA = oa!.id
  ordenB = ob!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.shopfloor_sessions disable trigger no_editar_sesion_cerrada')
  await sql.unsafe('alter table public.shopfloor_downtime disable trigger no_editar_paro_cerrado')
  await sql`delete from public.shopfloor_sessions where tenant_id in ${sql(ts)}`
  await sql`delete from public.shopfloor_downtime where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.shopfloor_sessions enable trigger no_editar_sesion_cerrada')
  await sql.unsafe('alter table public.shopfloor_downtime enable trigger no_editar_paro_cerrado')
  await sql.unsafe('alter table public.production_orders disable trigger no_editar_orden_produccion_resuelta')
  await sql`delete from public.production_orders where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.production_orders enable trigger no_editar_orden_produccion_resuelta')
  await sql.unsafe('alter table public.bill_of_materials disable trigger no_editar_bom_no_borrador')
  await sql`delete from public.bill_of_materials where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.bill_of_materials enable trigger no_editar_bom_no_borrador')
  await sql`delete from public.products where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia orden normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.production_orders`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no puede colar una sesion con la orden de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.shopfloor_sessions (tenant_id, production_order_id)
          values (${tenantB}, ${ordenA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un paro con la orden de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.shopfloor_downtime (tenant_id, production_order_id, reason)
          values (${tenantB}, ${ordenA}, 'Falla electrica')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Abierta es editable; cerrada, no', () => {
  it('una sesion abierta SI se puede editar; cerrada, no', async () => {
    const [s] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.shopfloor_sessions (tenant_id, production_order_id)
        values (${tenantB}, ${ordenB}) returning id`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.shopfloor_sessions set operator_id = ${userB} where id = ${s!.id}`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.shopfloor_sessions set clocked_out_at = now() where id = ${s!.id}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.shopfloor_sessions set operator_id = ${userA} where id = ${s!.id}`),
    ).rejects.toThrow(/ya se cerro y no se edita/)
  })

  it('un paro abierto SI se puede editar; cerrado, no', async () => {
    const [d] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.shopfloor_downtime (tenant_id, production_order_id, reason)
        values (${tenantB}, ${ordenB}, 'Cambio de herramienta') returning id`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.shopfloor_downtime set reason = 'Cambio de herramienta -confirmado-' where id = ${d!.id}`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.shopfloor_downtime set ended_at = now() where id = ${d!.id}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.shopfloor_downtime set reason = 'x' where id = ${d!.id}`),
    ).rejects.toThrow(/ya se cerro y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'shopfloor', true))

  it('sin el modulo, las sesiones dan cero filas', async () => {
    await modulo(tenantB, 'shopfloor', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.shopfloor_sessions`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('cerrar antes de abrir se rechaza -clocked_out_at antes de clocked_in_at-', async () => {
    await expect(
      sql`insert into public.shopfloor_sessions (tenant_id, production_order_id, clocked_in_at, clocked_out_at)
        values (${tenantA}, ${ordenA}, now(), now() - interval '1 hour')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un ciclo ideal de cero o negativo se rechaza', async () => {
    await expect(
      sql`update public.production_orders set ideal_cycle_hours = 0 where id = ${ordenA}`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
