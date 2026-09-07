import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Nomina (modulo 62, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una linea de nomina con un empleado de A usando
 *     su PROPIO tenant_id. Mismo patron que 0040, 0041, 0044-0048,
 *     0050-0051.
 *  3. Un periodo procesado -o sus lineas- queda inmutable.
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
    values (${`pr-a-${RUN}`}, 'Ferreteria PR A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`pr-b-${RUN}`}, 'Distribuidora PR B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'payroll', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ea] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantA}, ${`E1-${RUN}`}, 'Maria', 'Rosario', current_date - 365, 'Cajera', 30000)
    returning id`
  const [eb] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantB}, ${`E1-${RUN}`}, 'Juan', 'Perez', current_date - 100, 'Vendedor', 25000)
    returning id`
  empleadoA = ea!.id
  empleadoB = eb!.id

  const [pa] = await sql`
    insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
    values (${tenantA}, current_date - 15, current_date, current_date) returning id`
  periodoA = pa!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.payroll_lines disable trigger no_editar_linea_procesada')
  await sql.unsafe('alter table public.payroll_periods disable trigger no_editar_periodo_procesado')
  await sql`delete from public.payroll_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.payroll_periods where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.payroll_lines enable trigger no_editar_linea_procesada')
  await sql.unsafe('alter table public.payroll_periods enable trigger no_editar_periodo_procesado')
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio periodo normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.payroll_periods`,
    )
    expect(filas.map((f) => f.id)).toEqual([periodoA])
  })

  it('B no ve el periodo de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.payroll_periods where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una linea de nomina con un empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.payroll_lines
            (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
          values (${tenantB}, ${periodoA}, ${empleadoA}, 30000, 1773, 0, 28227)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B procesa su propia nomina normalmente: aislar no rompe lo propio', async () => {
    const [pb] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
        values (${tenantB}, current_date - 15, current_date, current_date) returning id`,
    )
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.payroll_lines
          (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
        values (${tenantB}, ${pb!.id}, ${empleadoB}, 25000, 1477.50, 0, 23522.50)`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.payroll_lines`,
    )
    expect(filas).toHaveLength(1)
  })
})

describe('Un periodo procesado es inmutable', () => {
  it('mientras esta en borrador, se pueden agregar lineas', async () => {
    await sql`
      insert into public.payroll_lines
        (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
      values (${tenantA}, ${periodoA}, ${empleadoA}, 30000, 1773, 0, 28227)`
    const filas = await sql`select id from public.payroll_lines where period_id = ${periodoA}`
    expect(filas).toHaveLength(1)
  })

  it('procesar el periodo y luego insertar otra linea se rechaza', async () => {
    await sql`
      update public.payroll_periods
      set status = 'processed', tax_params = '{"afpEmployeeRate":0.0287}'::jsonb
      where id = ${periodoA}`
    await expect(
      sql`
        insert into public.payroll_lines
          (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
        values (${tenantA}, ${periodoA}, ${empleadoA}, 1, 0, 0, 1)`,
    ).rejects.toThrow(/no se edita/)
  })

  it('un periodo procesado no se puede editar', async () => {
    await expect(
      sql`update public.payroll_periods set pay_date = current_date + 1 where id = ${periodoA}`,
    ).rejects.toThrow(/no se edita/)
  })

  it('una linea de un periodo ya procesado no se puede editar', async () => {
    await expect(
      sql`update public.payroll_lines set net_salary = 1 where period_id = ${periodoA}`,
    ).rejects.toThrow(/no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'payroll', true))

  it('sin el modulo, los periodos dan cero filas', async () => {
    await modulo(tenantB, 'payroll', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.payroll_periods`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un periodo con fechas invertidas se rechaza', async () => {
    await expect(
      sql`
        insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
        values (${tenantB}, current_date, current_date - 10, current_date)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo empleado no puede tener dos lineas en el mismo periodo', async () => {
    const [otroPeriodo] = await sql`
      insert into public.payroll_periods (tenant_id, period_start, period_end, pay_date)
      values (${tenantA}, current_date + 1, current_date + 15, current_date + 15) returning id`
    await sql`
      insert into public.payroll_lines
        (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
      values (${tenantA}, ${otroPeriodo!.id}, ${empleadoA}, 30000, 1773, 0, 28227)`
    await expect(
      sql`
        insert into public.payroll_lines
          (tenant_id, period_id, employee_id, gross_salary, tss_deduction, income_tax, net_salary)
        values (${tenantA}, ${otroPeriodo!.id}, ${empleadoA}, 30000, 1773, 0, 28227)`,
    ).rejects.toThrow(/duplicate key/)
  })
})
