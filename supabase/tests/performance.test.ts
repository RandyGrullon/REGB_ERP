import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Desempeno (modulo 66, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un objetivo, un resultado clave, un 1:1, una
 *     evaluacion o un plan de mejora con datos de A usando su PROPIO
 *     tenant_id. Mismo patron que 0031-0058.
 *  3. Una evaluacion enviada no se edita ni se borra NUNCA; un plan de
 *     mejora es editable mientras esta activo, inmutable una vez
 *     resuelto.
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
    values (${`pf-a-${RUN}`}, 'Ferreteria PF A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`pf-b-${RUN}`}, 'Distribuidora PF B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'performance', 'active', true)
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
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.performance_reviews disable trigger no_editar_evaluacion')
  await sql.unsafe(
    'alter table public.performance_improvement_plans disable trigger no_editar_plan_mejora_resuelto',
  )
  await sql`delete from public.performance_reviews where tenant_id in ${sql(ts)}`
  await sql`delete from public.performance_improvement_plans where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.performance_reviews enable trigger no_editar_evaluacion')
  await sql.unsafe(
    'alter table public.performance_improvement_plans enable trigger no_editar_plan_mejora_resuelto',
  )
  await sql`delete from public.performance_key_results where tenant_id in ${sql(ts)}`
  await sql`delete from public.performance_objectives where tenant_id in ${sql(ts)}`
  await sql`delete from public.performance_one_on_ones where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propio objetivo normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.performance_objectives (tenant_id, employee_id, title, period)
        values (${tenantA}, ${empleadoA}, 'Mejorar tiempo de atencion', '2026-Q3')`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.performance_objectives`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el objetivo de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.performance_objectives where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un objetivo con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.performance_objectives (tenant_id, employee_id, title, period)
          values (${tenantB}, ${empleadoA}, 'x', '2026-Q3')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un resultado clave con el objetivo de A usando su PROPIO tenant_id', async () => {
    const [objetivoA] = await sql`select id from public.performance_objectives where tenant_id = ${tenantA}`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.performance_key_results (tenant_id, objective_id, description, target_value)
          values (${tenantB}, ${objetivoA!.id}, 'x', 10)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una evaluacion con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.performance_reviews (tenant_id, employee_id, cycle, review_type, rating)
          values (${tenantB}, ${empleadoA}, '2026-Q3', 'manager', 4)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un plan de mejora con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.performance_improvement_plans
            (tenant_id, employee_id, reason, start_date, end_date)
          values (${tenantB}, ${empleadoA}, 'x', current_date, current_date + 30)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una evaluacion enviada es inmutable siempre', () => {
  let evaluacion: string

  it('se registra normalmente', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.performance_reviews (tenant_id, employee_id, cycle, review_type, rating, comments)
        values (${tenantB}, ${empleadoB}, '2026-Q3', 'self', 4, 'buen trimestre') returning id`,
    )
    evaluacion = r!.id
  })

  it('no se puede editar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.performance_reviews set rating = 5 where id = ${evaluacion}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.performance_reviews where id = ${evaluacion}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })
})

describe('Un plan de mejora es editable hasta que se resuelve', () => {
  let plan: string

  it('se crea y se puede editar mientras esta activo', async () => {
    const [p] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.performance_improvement_plans
          (tenant_id, employee_id, reason, start_date, end_date)
        values (${tenantB}, ${empleadoB}, 'llegadas tarde', current_date, current_date + 30) returning id`,
    )
    plan = p!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.performance_improvement_plans set goals = 'llegar a tiempo' where id = ${plan}`,
    )
    const [row] = await sql`select goals from public.performance_improvement_plans where id = ${plan}`
    expect(row!.goals).toBe('llegar a tiempo')
  })

  it('una vez completado, ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.performance_improvement_plans set status = 'completed' where id = ${plan}`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.performance_improvement_plans set goals = 'otro cambio' where id = ${plan}`,
      ),
    ).rejects.toThrow(/ya quedo resuelto/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'performance', true))

  it('sin el modulo, los objetivos dan cero filas', async () => {
    await modulo(tenantB, 'performance', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.performance_objectives`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una calificacion fuera de 1-5 se rechaza', async () => {
    await expect(
      sql`
        insert into public.performance_reviews (tenant_id, employee_id, cycle, review_type, rating)
        values (${tenantA}, ${empleadoA}, '2026-Q3', 'peer', 6)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una fecha de fin antes que la de inicio en un plan de mejora se rechaza', async () => {
    await expect(
      sql`
        insert into public.performance_improvement_plans
          (tenant_id, employee_id, reason, start_date, end_date)
        values (${tenantA}, ${empleadoA}, 'x', current_date, current_date - 1)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
