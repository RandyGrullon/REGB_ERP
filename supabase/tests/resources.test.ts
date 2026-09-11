import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Planificacion de recursos (modulo 75, F10) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una asignacion con la tarea de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0096.
 *  3. Las horas asignadas se DERIVAN -resource_allocated_hours()-,
 *     nunca se guardan agregadas, y la misma persona no se asigna dos
 *     veces a la misma tarea en la misma semana.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
const LUNES = '2026-09-07'
let tenantA: string
let tenantB: string
let tareaA: string
let tareaB: string

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
    values (${`res-a-${RUN}`}, 'Recursos A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`res-b-${RUN}`}, 'Recursos B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'projects', 'active', true), (${t}, 'resources', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [proyA] = await sql`insert into public.projects (tenant_id, name) values (${tenantA}, 'Proyecto A') returning id`
  const [proyB] = await sql`insert into public.projects (tenant_id, name) values (${tenantB}, 'Proyecto B') returning id`
  const [ta] = await sql`insert into public.project_tasks (tenant_id, project_id, name) values (${tenantA}, ${proyA!.id}, 'Tarea A') returning id`
  const [tb] = await sql`insert into public.project_tasks (tenant_id, project_id, name) values (${tenantB}, ${proyB!.id}, 'Tarea B') returning id`
  tareaA = ta!.id
  tareaB = tb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.resource_allocations where tenant_id in ${sql(ts)}`
  await sql`delete from public.resource_capacity where tenant_id in ${sql(ts)}`
  await sql`delete from public.project_tasks where tenant_id in ${sql(ts)}`
  await sql`delete from public.projects where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia capacidad normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`insert into public.resource_capacity (tenant_id, user_id, week_start) values (${tenantA}, ${userA}, ${LUNES})`,
    )
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.resource_capacity`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la capacidad de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.resource_capacity where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una asignacion con la tarea de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.resource_allocations (tenant_id, task_id, user_id, week_start, hours)
          values (${tenantB}, ${tareaA}, ${userB}, ${LUNES}, 8)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Las horas asignadas se derivan, nunca se guardan agregadas', () => {
  it('suma las asignaciones de esa persona en esa semana', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.resource_allocations (tenant_id, task_id, user_id, week_start, hours)
        values (${tenantB}, ${tareaB}, ${userB}, ${LUNES}, 12)`,
    )
    const [total] = await sql`select public.resource_allocated_hours(${tenantB}, ${userB}, ${LUNES})::text as horas`
    expect(total!.horas).toBe('12.00')
  })

  it('la misma persona no se asigna dos veces a la misma tarea en la misma semana', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.resource_allocations (tenant_id, task_id, user_id, week_start, hours)
          values (${tenantB}, ${tareaB}, ${userB}, ${LUNES}, 4)`,
      ),
    ).rejects.toThrow(/duplicate key/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'resources', true))

  it('sin el modulo, la capacidad da cero filas', async () => {
    await modulo(tenantB, 'resources', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.resource_capacity`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('mas de 168 horas de capacidad en una semana se rechaza', async () => {
    await expect(
      sql`insert into public.resource_capacity (tenant_id, user_id, week_start, hours_capacity) values (${tenantA}, ${crypto.randomUUID()}, ${LUNES}, 200)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una asignacion de cero horas se rechaza', async () => {
    await expect(
      sql`insert into public.resource_allocations (tenant_id, task_id, user_id, week_start, hours) values (${tenantA}, ${tareaA}, ${userA}, ${LUNES}, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la misma persona no repite fila de capacidad en la misma semana', async () => {
    await expect(
      sql`insert into public.resource_capacity (tenant_id, user_id, week_start) values (${tenantA}, ${userA}, ${LUNES})`,
    ).rejects.toThrow(/duplicate key/)
  })
})
