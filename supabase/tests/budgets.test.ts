import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Presupuestos (modulo 22, F6) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una linea en un presupuesto de A -ni con una
 *     cuenta de A- usando su PROPIO tenant_id. Mismo patron que 0040,
 *     0041, 0044, 0045 y 0046.
 *  3. Un presupuesto cerrado se congela: ni el ni sus lineas se editan.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let cuentaA: string
let cuentaB: string
let presupuestoA: string
let presupuestoB: string

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
    values (${`bu-a-${RUN}`}, 'Ferreteria BU A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`bu-b-${RUN}`}, 'Distribuidora BU B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'accounting', 'active', true), (${t}, 'budgets', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantA}, '6100', 'Gastos generales', 'expense') returning id`
  const [cb] = await sql`
    insert into public.accounts (tenant_id, code, name, type)
    values (${tenantB}, '6100', 'Gastos generales', 'expense') returning id`
  cuentaA = ca!.id
  cuentaB = cb!.id

  const [pa] = await sql`
    insert into public.budgets (tenant_id, name, fiscal_year)
    values (${tenantA}, 'Presupuesto 2026', 2026) returning id`
  const [pb] = await sql`
    insert into public.budgets (tenant_id, name, fiscal_year)
    values (${tenantB}, 'Presupuesto 2026', 2026) returning id`
  presupuestoA = pa!.id
  presupuestoB = pb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.budget_lines disable trigger no_editar_linea_presupuesto_cerrado')
  await sql.unsafe('alter table public.budgets disable trigger no_editar_presupuesto_cerrado')
  await sql`delete from public.budget_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.budgets where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.budget_lines enable trigger no_editar_linea_presupuesto_cerrado')
  await sql.unsafe('alter table public.budgets enable trigger no_editar_presupuesto_cerrado')
  await sql`delete from public.accounts where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio presupuesto normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.budgets`,
    )
    expect(filas.map((f) => f.id)).toEqual([presupuestoA])
  })

  it('B no ve los presupuestos de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.budgets where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una linea en un presupuesto de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.budget_lines (tenant_id, budget_id, account_id, period_month, amount)
          values (${tenantB}, ${presupuestoA}, ${cuentaB}, 1, 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede usar una cuenta de A aunque el presupuesto sea suyo', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.budget_lines (tenant_id, budget_id, account_id, period_month, amount)
          values (${tenantB}, ${presupuestoB}, ${cuentaA}, 1, 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B presupuesta normalmente en SU propio presupuesto y cuenta: aislar no rompe lo propio', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.budget_lines (tenant_id, budget_id, account_id, period_month, amount)
        values (${tenantB}, ${presupuestoB}, ${cuentaB}, 1, 5000)`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.budget_lines`,
    )
    expect(filas).toHaveLength(1)
  })
})

describe('Un presupuesto cerrado se congela', () => {
  it('la linea se puede editar mientras esta activo', async () => {
    await sql`
      insert into public.budget_lines (tenant_id, budget_id, account_id, period_month, amount)
      values (${tenantA}, ${presupuestoA}, ${cuentaA}, 1, 4000)`
    await sql`
      update public.budget_lines set amount = 4500
      where budget_id = ${presupuestoA} and period_month = 1`
    const [l] = await sql<{ amount: string }[]>`
      select amount::text from public.budget_lines where budget_id = ${presupuestoA} and period_month = 1`
    expect(Number(l!.amount)).toBe(4500)
  })

  it('cerrar el presupuesto y luego editar una linea se rechaza', async () => {
    await sql`update public.budgets set status = 'closed' where id = ${presupuestoA}`
    await expect(
      sql`update public.budget_lines set amount = 1 where budget_id = ${presupuestoA} and period_month = 1`,
    ).rejects.toThrow(/no se edita/)
  })

  it('un presupuesto cerrado tampoco se reabre editando su status', async () => {
    await expect(
      sql`update public.budgets set status = 'active' where id = ${presupuestoA}`,
    ).rejects.toThrow(/no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'budgets', true))

  it('sin el modulo, los presupuestos dan cero filas', async () => {
    await modulo(tenantB, 'budgets', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.budgets`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un mes fuera de 1-12 se rechaza', async () => {
    await expect(
      sql`
        insert into public.budget_lines (tenant_id, budget_id, account_id, period_month, amount)
        values (${tenantB}, ${presupuestoB}, ${cuentaB}, 13, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo nombre de presupuesto no se repite para el mismo ano y cliente', async () => {
    await expect(
      sql`
        insert into public.budgets (tenant_id, name, fiscal_year)
        values (${tenantB}, 'Presupuesto 2026', 2026)`,
    ).rejects.toThrow(/duplicate key/)
  })
})
