import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Comisiones (modulo 34, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una comision con el plan o la orden de venta
 *     de A usando su PROPIO tenant_id. Mismo patron que 0031-0082.
 *  3. Pendiente es editable; resuelta (approved/rejected/paid) se
 *     congela.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let planA: string
let planB: string
let almacenA: string
let almacenB: string
let clienteA: string
let clienteB: string
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
    values (${`cm-a-${RUN}`}, 'Ventas CM A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`cm-b-${RUN}`}, 'Ventas CM B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'sales-orders', 'active', true), (${t}, 'commissions', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [wa] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantA}, 'Central A') returning id`
  const [wb] = await sql`insert into public.warehouses (tenant_id, name) values (${tenantB}, 'Central B') returning id`
  almacenA = wa!.id
  almacenB = wb!.id

  const [ca] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantA}, 'Cliente A', 30) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantB}, 'Cliente B', 30) returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [oa] = await sql`
    insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id, total)
    values (${tenantA}, ${`SO-A-${RUN}`}, ${clienteA}, ${almacenA}, 10000) returning id`
  const [ob] = await sql`
    insert into public.sales_orders (tenant_id, number, customer_id, warehouse_id, total)
    values (${tenantB}, ${`SO-B-${RUN}`}, ${clienteB}, ${almacenB}, 10000) returning id`
  ordenA = oa!.id
  ordenB = ob!.id

  const [pa] = await sql`
    insert into public.commission_plans (tenant_id, name, basis, rate) values (${tenantA}, 'Plan A', 'percentage', 0.05) returning id`
  const [pb] = await sql`
    insert into public.commission_plans (tenant_id, name, basis, rate) values (${tenantB}, 'Plan B', 'percentage', 0.05) returning id`
  planA = pa!.id
  planB = pb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.commission_entries disable trigger no_editar_comision_resuelta')
  await sql`delete from public.commission_entries where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.commission_entries enable trigger no_editar_comision_resuelta')
  await sql`delete from public.commission_plans where tenant_id in ${sql(ts)}`
  await sql`delete from public.sales_orders where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from public.warehouses where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia comision normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.commission_entries (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount)
        values (${tenantA}, ${planA}, ${ordenA}, ${userA}, 10000, 500)`,
    )
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.commission_entries`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la comision de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.commission_entries where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una comision con el plan de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.commission_entries (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount)
          values (${tenantB}, ${planA}, ${ordenB}, ${userB}, 10000, 500)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una comision con la orden de venta de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.commission_entries (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount)
          values (${tenantB}, ${planB}, ${ordenA}, ${userB}, 10000, 500)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B ve su propia comision normalmente: aislar no rompe lo propio', async () => {
    const [e] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.commission_entries (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount)
        values (${tenantB}, ${planB}, ${ordenB}, ${userB}, 10000, 500) returning id`,
    )
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.commission_entries where id = ${e!.id}`)
    expect(filas).toHaveLength(1)
  })
})

describe('Pendiente y aprobada son editables -aprobada tiene que poder avanzar a pagada-; pagada se congela', () => {
  let entrada: string

  it('pendiente, el monto es editable', async () => {
    const [e] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.commission_entries (tenant_id, plan_id, sales_order_id, salesperson_id, base_amount, commission_amount)
        values (${tenantB}, ${planB}, ${ordenB}, ${userB}, 10000, 500) returning id`,
    )
    entrada = e!.id
    await as(userB, tenantB, (tx) => tx`update public.commission_entries set commission_amount = 600 where id = ${entrada}`)
    const [row] = await sql`select commission_amount::text from public.commission_entries where id = ${entrada}`
    expect(row!.commission_amount).toBe('600.00')
  })

  it('aprobada SI se puede seguir editando -tiene que poder avanzar a pagada, no es terminal-', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.commission_entries set status = 'approved', approved_at = now() where id = ${entrada}`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.commission_entries set status = 'paid', paid_at = now() where id = ${entrada}`,
    )
    const [row] = await sql`select status from public.commission_entries where id = ${entrada}`
    expect(row!.status).toBe('paid')
  })

  it('pagada, ya no se puede editar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.commission_entries set commission_amount = 1 where id = ${entrada}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'commissions', true))

  it('sin el modulo, las comisiones dan cero filas', async () => {
    await modulo(tenantB, 'commissions', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.commission_entries`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un esquema de plan inventado se rechaza', async () => {
    await expect(
      sql`insert into public.commission_plans (tenant_id, name, basis, rate) values (${tenantA}, 'x', 'invalido', 1)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una tasa de cero o negativa se rechaza', async () => {
    await expect(
      sql`insert into public.commission_plans (tenant_id, name, basis, rate) values (${tenantA}, 'x', 'percentage', 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
