import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Hojas de tiempo (modulo 72, F10) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un registro con la tarea de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0094.
 *  3. Un registro es editable hasta aprobarse; rechazado se corrige y
 *     reenvia; aprobado es terminal de verdad.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
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
    values (${`ts-a-${RUN}`}, 'Timesheets A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ts-b-${RUN}`}, 'Timesheets B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'projects', 'active', true), (${t}, 'timesheets', 'active', true)
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
  await sql.unsafe('alter table public.time_entries disable trigger no_editar_registro_aprobado')
  await sql`delete from public.time_entries where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.time_entries enable trigger no_editar_registro_aprobado')
  await sql`delete from public.project_tasks where tenant_id in ${sql(ts)}`
  await sql`delete from public.projects where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio registro normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`insert into public.time_entries (tenant_id, task_id, user_id, entry_date, hours) values (${tenantA}, ${tareaA}, ${userA}, current_date, 4)`,
    )
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.time_entries`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el registro de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.time_entries where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un registro con la tarea de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`insert into public.time_entries (tenant_id, task_id, user_id, entry_date, hours) values (${tenantB}, ${tareaA}, ${userB}, current_date, 2)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Editable hasta aprobarse; rechazado se corrige; aprobado es terminal', () => {
  let registro: string

  it('borrador avanza a enviado y rechazado', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`insert into public.time_entries (tenant_id, task_id, user_id, entry_date, hours) values (${tenantB}, ${tareaB}, ${userB}, current_date, 3) returning id`,
    )
    registro = r!.id
    await as(userB, tenantB, (tx) => tx`update public.time_entries set status = 'submitted' where id = ${registro}`)
    await as(userB, tenantB, (tx) => tx`update public.time_entries set status = 'rejected' where id = ${registro}`)
    const [row] = await sql`select status from public.time_entries where id = ${registro}`
    expect(row!.status).toBe('rejected')
  })

  it('rechazado se corrige y se puede reenviar', async () => {
    await as(userB, tenantB, (tx) => tx`update public.time_entries set status = 'draft', hours = 4 where id = ${registro}`)
    await as(userB, tenantB, (tx) => tx`update public.time_entries set status = 'submitted' where id = ${registro}`)
    const [row] = await sql`select status, hours::text from public.time_entries where id = ${registro}`
    expect(row!.status).toBe('submitted')
    expect(row!.hours).toBe('4.00')
  })

  it('aprobado, ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.time_entries set status = 'approved', approved_at = now() where id = ${registro}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.time_entries set hours = 8 where id = ${registro}`),
    ).rejects.toThrow(/ya se aprobo y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'timesheets', true))

  it('sin el modulo, los registros dan cero filas', async () => {
    await modulo(tenantB, 'timesheets', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.time_entries`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('mas de 24 horas en un registro se rechaza', async () => {
    await expect(
      sql`insert into public.time_entries (tenant_id, task_id, user_id, entry_date, hours) values (${tenantA}, ${tareaA}, ${userA}, current_date, 30)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('cero horas se rechaza', async () => {
    await expect(
      sql`insert into public.time_entries (tenant_id, task_id, user_id, entry_date, hours) values (${tenantA}, ${tareaA}, ${userA}, current_date, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
