import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Vacaciones & Permisos (modulo 64, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una solicitud con el empleado de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0053.
 *  3. Una solicitud resuelta -aprobada, rechazada o cancelada- no se
 *     edita ni se borra.
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
    values (${`to-a-${RUN}`}, 'Ferreteria TO A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`to-b-${RUN}`}, 'Distribuidora TO B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'time-off', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ea] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantA}, ${`E1-${RUN}`}, 'Maria', 'Rosario', current_date - 800, 'Cajera', 25000)
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
  await sql.unsafe('alter table public.time_off_requests disable trigger no_editar_solicitud_resuelta')
  await sql`delete from public.time_off_requests where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.time_off_requests enable trigger no_editar_solicitud_resuelta')
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propia solicitud normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.time_off_requests
          (tenant_id, employee_id, leave_type, start_date, end_date, business_days)
        values (${tenantA}, ${empleadoA}, 'vacation', current_date, current_date + 4, 5)`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.time_off_requests`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la solicitud de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.time_off_requests where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una solicitud con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.time_off_requests
            (tenant_id, employee_id, leave_type, start_date, end_date, business_days)
          values (${tenantB}, ${empleadoA}, 'vacation', current_date, current_date + 1, 2)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Una solicitud resuelta es inmutable', () => {
  let solicitud: string

  it('la solicitud pendiente se crea sin problema', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.time_off_requests
          (tenant_id, employee_id, leave_type, start_date, end_date, business_days)
        values (${tenantB}, ${empleadoB}, 'sick', current_date, current_date, 1)
        returning id`,
    )
    solicitud = r!.id
  })

  it('aprobarla -pendiente a resuelta- funciona normal', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        update public.time_off_requests set status = 'approved'
        where id = ${solicitud} and tenant_id = ${tenantB}`,
    )
    const [row] = await sql`select status from public.time_off_requests where id = ${solicitud}`
    expect(row!.status).toBe('approved')
  })

  it('una vez aprobada, no se puede volver a editar', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          update public.time_off_requests set status = 'rejected'
          where id = ${solicitud} and tenant_id = ${tenantB}`,
      ),
    ).rejects.toThrow(/ya fue resuelta/)
  })

  it('una vez aprobada, tampoco se puede borrar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`delete from public.time_off_requests where id = ${solicitud}`),
    ).rejects.toThrow(/ya fue resuelta/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'time-off', true))

  it('sin el modulo, las solicitudes dan cero filas', async () => {
    await modulo(tenantB, 'time-off', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.time_off_requests`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una fecha de fin antes que la de inicio se rechaza', async () => {
    await expect(
      sql`
        insert into public.time_off_requests
          (tenant_id, employee_id, leave_type, start_date, end_date, business_days)
        values (${tenantA}, ${empleadoA}, 'vacation', current_date, current_date - 1, 1)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('cero dias laborables se rechaza', async () => {
    await expect(
      sql`
        insert into public.time_off_requests
          (tenant_id, employee_id, leave_type, start_date, end_date, business_days)
        values (${tenantA}, ${empleadoA}, 'vacation', current_date, current_date, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un tipo de ausencia inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.time_off_requests
          (tenant_id, employee_id, leave_type, start_date, end_date, business_days)
        values (${tenantA}, ${empleadoA}, 'siesta', current_date, current_date, 1)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un estado inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.time_off_requests
          (tenant_id, employee_id, leave_type, start_date, end_date, business_days, status)
        values (${tenantA}, ${empleadoA}, 'vacation', current_date, current_date, 1, 'en_el_limbo')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
