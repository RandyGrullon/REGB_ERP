import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Capacitacion / LMS (modulo 67, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una inscripcion, un certificado o una
 *     competencia con datos de A usando su PROPIO tenant_id. Mismo
 *     patron que 0031-0059.
 *  3. Un certificado emitido no se edita ni se borra NUNCA; una
 *     inscripcion resuelta (completed/failed) tampoco.
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
let cursoA: string
let cursoB: string
let competenciaA: string

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
      values (${t}, 'employees', 'active', true), (${t}, 'training', 'active', true)
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

  const [ca] = await sql`
    insert into public.training_courses (tenant_id, title) values (${tenantA}, 'Atencion al cliente') returning id`
  const [cb] = await sql`
    insert into public.training_courses (tenant_id, title) values (${tenantB}, 'Manejo de caja') returning id`
  cursoA = ca!.id
  cursoB = cb!.id

  const [compA] = await sql`
    insert into public.training_competencies (tenant_id, name) values (${tenantA}, 'Ventas') returning id`
  competenciaA = compA!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.training_certificates disable trigger no_editar_certificado')
  await sql.unsafe('alter table public.training_enrollments disable trigger no_editar_inscripcion_resuelta')
  await sql`delete from public.training_certificates where tenant_id in ${sql(ts)}`
  await sql`delete from public.training_enrollments where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.training_certificates enable trigger no_editar_certificado')
  await sql.unsafe('alter table public.training_enrollments enable trigger no_editar_inscripcion_resuelta')
  await sql`delete from public.training_employee_competencies where tenant_id in ${sql(ts)}`
  await sql`delete from public.training_competencies where tenant_id in ${sql(ts)}`
  await sql`delete from public.training_courses where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A inscribe a su propio empleado en su propio curso normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.training_enrollments (tenant_id, course_id, employee_id)
        values (${tenantA}, ${cursoA}, ${empleadoA})`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.training_enrollments`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la inscripcion de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.training_enrollments where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una inscripcion con el curso de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.training_enrollments (tenant_id, course_id, employee_id)
          values (${tenantB}, ${cursoA}, ${empleadoB})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una inscripcion con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.training_enrollments (tenant_id, course_id, employee_id)
          values (${tenantB}, ${cursoB}, ${empleadoA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un certificado con la inscripcion de A usando su PROPIO tenant_id', async () => {
    const [inscripcionA] = await sql`
      select id from public.training_enrollments where tenant_id = ${tenantA}`
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.training_certificates (tenant_id, enrollment_id)
          values (${tenantB}, ${inscripcionA!.id})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una competencia de empleado con la competencia de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.training_employee_competencies (tenant_id, employee_id, competency_id, level)
          values (${tenantB}, ${empleadoB}, ${competenciaA}, 3)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una inscripcion resuelta y un certificado emitido son inmutables', () => {
  let inscripcion: string
  let certificado: string

  it('se completa normalmente con una nota', async () => {
    const [i] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.training_enrollments (tenant_id, course_id, employee_id)
        values (${tenantB}, ${cursoB}, ${empleadoB}) returning id`,
    )
    inscripcion = i!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`
        update public.training_enrollments set status = 'completed', score = 85, completed_at = now()
        where id = ${inscripcion}`,
    )
    const [row] = await sql`select status from public.training_enrollments where id = ${inscripcion}`
    expect(row!.status).toBe('completed')
  })

  it('una vez completada, la inscripcion ya no se puede editar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.training_enrollments set score = 100 where id = ${inscripcion}`),
    ).rejects.toThrow(/ya quedo resuelta/)
  })

  it('se emite un certificado para esa inscripcion', async () => {
    const [c] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.training_certificates (tenant_id, enrollment_id) values (${tenantB}, ${inscripcion}) returning id`,
    )
    certificado = c!.id
    expect(certificado).toBeTruthy()
  })

  it('el certificado emitido nunca se puede editar', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.training_certificates set expires_at = now() where id = ${certificado}`,
      ),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.training_certificates where id = ${certificado}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'training', true))

  it('sin el modulo, los cursos dan cero filas', async () => {
    await modulo(tenantB, 'training', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.training_courses`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un nivel de competencia fuera de 1-5 se rechaza', async () => {
    await expect(
      sql`
        insert into public.training_employee_competencies (tenant_id, employee_id, competency_id, level)
        values (${tenantA}, ${empleadoA}, ${competenciaA}, 6)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la misma competencia para el mismo empleado no se repite', async () => {
    await sql`
      insert into public.training_employee_competencies (tenant_id, employee_id, competency_id, level)
      values (${tenantA}, ${empleadoA}, ${competenciaA}, 3)`
    await expect(
      sql`
        insert into public.training_employee_competencies (tenant_id, employee_id, competency_id, level)
        values (${tenantA}, ${empleadoA}, ${competenciaA}, 4)`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })
})
