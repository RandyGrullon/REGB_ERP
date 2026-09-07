import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Beneficios (modulo 69, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un prestamo, un pago o una inscripcion con datos
 *     de A usando su PROPIO tenant_id. Mismo patron que 0031-0056.
 *  3. Un pago de prestamo ya registrado no se edita ni se borra NUNCA
 *     -a diferencia del prestamo mismo, que solo es inmutable una vez
 *     saldado o cancelado-.
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
    values (${`bn-a-${RUN}`}, 'Ferreteria BN A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`bn-b-${RUN}`}, 'Distribuidora BN B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'payroll', 'active', true),
             (${t}, 'benefits', 'active', true)
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
  await sql.unsafe('alter table public.benefit_loan_payments disable trigger no_editar_pago_prestamo')
  await sql.unsafe('alter table public.benefit_loans disable trigger no_editar_prestamo_resuelto')
  await sql.unsafe('alter table public.benefit_enrollments disable trigger no_editar_inscripcion_cancelada')
  await sql`delete from public.benefit_loan_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.benefit_loans where tenant_id in ${sql(ts)}`
  await sql`delete from public.benefit_enrollments where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.benefit_loan_payments enable trigger no_editar_pago_prestamo')
  await sql.unsafe('alter table public.benefit_loans enable trigger no_editar_prestamo_resuelto')
  await sql.unsafe('alter table public.benefit_enrollments enable trigger no_editar_inscripcion_cancelada')
  await sql`delete from public.payroll_periods where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propio prestamo normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.benefit_loans
          (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date)
        values (${tenantA}, ${empleadoA}, 'loan', 12000, 12, 1000, current_date)`,
    )
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.benefit_loans`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el prestamo de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.benefit_loans where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un prestamo con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.benefit_loans
            (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date)
          values (${tenantB}, ${empleadoA}, 'loan', 5000, 5, 1000, current_date)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un pago con el periodo de nomina de A usando su PROPIO tenant_id', async () => {
    const [prestamoB] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.benefit_loans
          (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date)
        values (${tenantB}, ${empleadoB}, 'advance', 3000, 3, 1000, current_date) returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.benefit_loan_payments (tenant_id, loan_id, amount, payroll_period_id)
          values (${tenantB}, ${prestamoB!.id}, 1000, ${periodoA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una inscripcion con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.benefit_enrollments
            (tenant_id, employee_id, plan_name, employee_contribution, employer_contribution, effective_date)
          values (${tenantB}, ${empleadoA}, 'Seguro Salud Basico', 500, 1200, current_date)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Un pago de prestamo es inmutable siempre -no solo cuando el prestamo se resuelve-', () => {
  let prestamo: string
  let pago: string

  it('el pago se registra normalmente mientras el prestamo esta activo', async () => {
    const [p] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.benefit_loans
          (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date)
        values (${tenantB}, ${empleadoB}, 'loan', 6000, 6, 1000, current_date) returning id`,
    )
    prestamo = p!.id
    const [pg] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.benefit_loan_payments (tenant_id, loan_id, amount)
        values (${tenantB}, ${prestamo}, 1000) returning id`,
    )
    pago = pg!.id
    expect(pago).toBeTruthy()
  })

  it('ese mismo pago NUNCA se puede editar, ni con el prestamo todavia activo', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.benefit_loan_payments set amount = 1 where id = ${pago}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('ese mismo pago tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.benefit_loan_payments where id = ${pago}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('el prestamo SI se puede editar mientras sigue activo -solo el pago es inmutable desde el principio-', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.benefit_loans set notes = 'nota agregada' where id = ${prestamo}`,
    )
    const [row] = await sql`select notes from public.benefit_loans where id = ${prestamo}`
    expect(row!.notes).toBe('nota agregada')
  })

  it('una vez el prestamo pasa a saldado, ya no se puede editar', async () => {
    await as(userB, tenantB, (tx) => tx`update public.benefit_loans set status = 'paid' where id = ${prestamo}`)
    await expect(
      as(userB, tenantB, (tx) => tx`update public.benefit_loans set notes = 'otro cambio' where id = ${prestamo}`),
    ).rejects.toThrow(/ya quedo resuelto/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'benefits', true))

  it('sin el modulo, los prestamos dan cero filas', async () => {
    await modulo(tenantB, 'benefits', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.benefit_loans`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un principal de cero o negativo se rechaza', async () => {
    await expect(
      sql`
        insert into public.benefit_loans
          (tenant_id, employee_id, loan_type, principal, installments, installment_amount, start_date)
        values (${tenantA}, ${empleadoA}, 'loan', 0, 5, 100, current_date)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la misma inscripcion en el mismo plan para el mismo empleado no se repite', async () => {
    await sql`
      insert into public.benefit_enrollments
        (tenant_id, employee_id, plan_name, employee_contribution, employer_contribution, effective_date)
      values (${tenantA}, ${empleadoA}, 'Seguro Salud Basico', 500, 1200, current_date)`
    await expect(
      sql`
        insert into public.benefit_enrollments
          (tenant_id, employee_id, plan_name, employee_contribution, employer_contribution, effective_date)
        values (${tenantA}, ${empleadoA}, 'Seguro Salud Basico', 600, 1200, current_date)`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})
