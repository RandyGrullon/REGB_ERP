import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Gastos & Reembolsos (modulo 68, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un gasto con el empleado -o el periodo de nomina-
 *     de A usando su PROPIO tenant_id. Mismo patron que 0031-0054.
 *  3. Un gasto rechazado o ya reembolsado no se edita ni se borra;
 *     'approved' SI puede seguir avanzando hasta 'reimbursed'.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let empleadoA: string
let empleadoB: string
let periodoA: string

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
    values (${`ex-a-${RUN}`}, 'Ferreteria EX A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ex-b-${RUN}`}, 'Distribuidora EX B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'payroll', 'active', true),
             (${t}, 'expenses', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ea] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantA}, ${`E1-${RUN}`}, 'Maria', 'Rosario', current_date - 400, 'Cajera', 25000)
    returning id`
  const [eb] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantB}, ${`E1-${RUN}`}, 'Juan', 'Perez', current_date - 400, 'Vendedor', 22000)
    returning id`
  empleadoA = ea!.id
  empleadoB = eb!.id

  const [pa] = await sql`
    insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
    values (${tenantA}, current_date - 30, current_date - 1, current_date)
    returning id`
  periodoA = pa!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.expenses disable trigger no_editar_gasto_resuelto')
  await sql`delete from public.expenses where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.expenses enable trigger no_editar_gasto_resuelto')
  await sql`delete from public.payroll_periods where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propio gasto normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.expenses (tenant_id, employee_id, category, expense_date, amount)
        values (${tenantA}, ${empleadoA}, 'meals', current_date, 1500)`,
    )
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.expenses`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el gasto de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.expenses where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un gasto con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.expenses (tenant_id, employee_id, category, expense_date, amount)
          values (${tenantB}, ${empleadoA}, 'meals', current_date, 1500)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un reembolso con el periodo de nomina de A usando su PROPIO tenant_id', async () => {
    const [gastoB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.expenses (tenant_id, employee_id, category, expense_date, amount, status)
        values (${tenantB}, ${empleadoB}, 'travel', current_date, 2000, 'approved') returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          update public.expenses set payroll_period_id = ${periodoA}
          where id = ${gastoB!.id} and tenant_id = ${tenantB}`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Un gasto resuelto', () => {
  let gasto: string

  it('se aprueba normalmente -pasa de submitted a approved-', async () => {
    const [g] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.expenses (tenant_id, employee_id, category, expense_date, amount)
        values (${tenantB}, ${empleadoB}, 'supplies', current_date, 800) returning id`,
    )
    gasto = g!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.expenses set status = 'approved' where id = ${gasto} and tenant_id = ${tenantB}`,
    )
    const [row] = await sql`select status from public.expenses where id = ${gasto}`
    expect(row!.status).toBe('approved')
  })

  it('aprobado SI puede seguir avanzando a reembolsado', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        update public.expenses set status = 'reimbursed', reimbursement_method = 'transfer'
        where id = ${gasto} and tenant_id = ${tenantB}`,
    )
    const [row] = await sql`select status from public.expenses where id = ${gasto}`
    expect(row!.status).toBe('reimbursed')
  })

  it('una vez reembolsado, no se puede volver a editar', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.expenses set amount = 1 where id = ${gasto} and tenant_id = ${tenantB}`,
      ),
    ).rejects.toThrow(/ya fue resuelto/)
  })

  it('una vez reembolsado, tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.expenses where id = ${gasto}`),
    ).rejects.toThrow(/ya fue resuelto/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'expenses', true))

  it('sin el modulo, los gastos dan cero filas', async () => {
    await modulo(tenantB, 'expenses', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.expenses`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un monto de cero o negativo se rechaza', async () => {
    await expect(
      sql`
        insert into public.expenses (tenant_id, employee_id, category, expense_date, amount)
        values (${tenantA}, ${empleadoA}, 'meals', current_date, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una categoria inventada se rechaza', async () => {
    await expect(
      sql`
        insert into public.expenses (tenant_id, employee_id, category, expense_date, amount)
        values (${tenantA}, ${empleadoA}, 'lujos', current_date, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un metodo de reembolso inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.expenses
          (tenant_id, employee_id, category, expense_date, amount, reimbursement_method)
        values (${tenantA}, ${empleadoA}, 'meals', current_date, 100, 'bitcoin')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
