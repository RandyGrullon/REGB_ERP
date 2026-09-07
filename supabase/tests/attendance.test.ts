import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Asistencia & Ponches (modulo 63, F7) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una geocerca ni un marcaje con datos de A usando
 *     su PROPIO tenant_id. Mismo patron que 0040-0052.
 *  3. Un empleado no puede tener dos marcajes abiertos a la vez.
 *  4. check_out_attendance() no deja cerrar dos veces ni con una salida
 *     anterior a la entrada.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let sucursalA: string
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
    values (${`att-a-${RUN}`}, 'Ferreteria ATT A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`att-b-${RUN}`}, 'Distribuidora ATT B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'attendance', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [c1] = await sql`
    insert into public.companies (tenant_id, legal_name, currency, is_default)
    values (${tenantA}, 'Ferreteria ATT A SRL', 'DOP', true) returning id`
  const [suc] = await sql`
    insert into public.branches (tenant_id, company_id, name, code)
    values (${tenantA}, ${c1!.id}, 'Principal', ${`PPAL-${RUN}`}) returning id`
  sucursalA = suc!.id

  const [ea] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantA}, ${`E1-${RUN}`}, 'Maria', 'Rosario', current_date - 365, 'Cajera', 25000)
    returning id`
  const [eb] = await sql`
    insert into public.employees
      (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantB}, ${`E1-${RUN}`}, 'Juan', 'Perez', current_date - 100, 'Vendedor', 22000)
    returning id`
  empleadoA = ea!.id
  empleadoB = eb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.attendance_records where tenant_id in ${sql(ts)}`
  await sql`delete from public.attendance_geofences where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from public.branches where tenant_id in ${sql(ts)}`
  await sql`delete from public.companies where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A registra su propia geocerca normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.attendance_geofences (tenant_id, branch_id, latitude, longitude, radius_meters)
        values (${tenantA}, ${sucursalA}, 18.4861, -69.9312, 100)`,
    )
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.attendance_geofences`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve la geocerca de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.attendance_geofences where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una geocerca con la sucursal de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.attendance_geofences (tenant_id, branch_id, latitude, longitude, radius_meters)
          values (${tenantB}, ${sucursalA}, 18.48, -69.93, 100)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un marcaje con el empleado de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.attendance_records (tenant_id, employee_id, check_in)
          values (${tenantB}, ${empleadoA}, now())`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Un marcaje abierto por empleado', () => {
  let marcaje: string

  it('el primer marcaje del dia entra sin problema', async () => {
    const [m] = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`
        insert into public.attendance_records (tenant_id, employee_id, check_in)
        values (${tenantA}, ${empleadoA}, now()) returning id`,
    )
    marcaje = m!.id
  })

  it('no se puede entrar dos veces sin haber marcado salida', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.attendance_records (tenant_id, employee_id, check_in)
          values (${tenantA}, ${empleadoA}, now())`,
      ),
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })

  it('B no puede cerrar el marcaje de A', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`select public.check_out_attendance(${marcaje})`),
    ).rejects.toThrow(/no es de esta cuenta/)
  })

  it('cerrar el marcaje funciona, y despues si se puede entrar de nuevo', async () => {
    await as(userA, tenantA, (tx) => tx`select public.check_out_attendance(${marcaje})`)
    await as(
      userA,
      tenantA,
      (tx) => tx`
        insert into public.attendance_records (tenant_id, employee_id, check_in)
        values (${tenantA}, ${empleadoA}, now())`,
    )
    const filas = await sql`select id from public.attendance_records where employee_id = ${empleadoA}`
    expect(filas).toHaveLength(2)
  })

  it('un marcaje ya cerrado no se puede cerrar dos veces', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`select public.check_out_attendance(${marcaje})`),
    ).rejects.toThrow(/ya tiene salida registrada/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'attendance', true))

  it('sin el modulo, las geocercas dan cero filas', async () => {
    await modulo(tenantB, 'attendance', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.attendance_geofences`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una latitud fuera de rango se rechaza', async () => {
    await expect(
      sql`
        insert into public.attendance_geofences (tenant_id, branch_id, latitude, longitude, radius_meters)
        values (${tenantA}, ${sucursalA}, 200, -69.93, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un check_out anterior al check_in se rechaza', async () => {
    await expect(
      sql`
        insert into public.attendance_records (tenant_id, employee_id, check_in, check_out)
        values (${tenantB}, ${empleadoB}, now(), now() - interval '1 hour')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
