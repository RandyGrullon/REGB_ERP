import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Flota & Vehiculos (modulo 54, F8) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un vehiculo, un documento, una carga de
 *     combustible, un mantenimiento o una multa con referencias de A
 *     usando su PROPIO tenant_id. Mismo patron que 0031-0069.
 *  3. Un vehiculo (registro vivo) SI se puede editar; combustible y
 *     mantenimiento son inmutables desde el primer insert; una multa
 *     es editable solo mientras no este resuelta.
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
let vehiculoA: string
let vehiculoB: string

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
    values (${`fl-a-${RUN}`}, 'Ferreteria FL A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`fl-b-${RUN}`}, 'Distribuidora FL B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'employees', 'active', true), (${t}, 'fleet', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ea] = await sql`
    insert into public.employees (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantA}, ${`E1-${RUN}`}, 'Maria', 'Rosario', current_date - 400, 'Chofer', 25000)
    returning id`
  const [eb] = await sql`
    insert into public.employees (tenant_id, code, first_name, last_name, hire_date, position, salary)
    values (${tenantB}, ${`E1-${RUN}`}, 'Juan', 'Perez', current_date - 400, 'Chofer', 22000)
    returning id`
  empleadoA = ea!.id
  empleadoB = eb!.id

  const [va] = await sql`
    insert into public.vehicles (tenant_id, plate, brand, model) values (${tenantA}, 'A123456', 'Toyota', 'Hilux') returning id`
  const [vb] = await sql`
    insert into public.vehicles (tenant_id, plate, brand, model) values (${tenantB}, 'B123456', 'Isuzu', 'NPR') returning id`
  vehiculoA = va!.id
  vehiculoB = vb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.fuel_logs disable trigger no_editar_combustible')
  await sql.unsafe('alter table public.maintenance_records disable trigger no_editar_mantenimiento')
  await sql.unsafe('alter table public.traffic_fines disable trigger no_editar_multa_resuelta')
  await sql`delete from public.fuel_logs where tenant_id in ${sql(ts)}`
  await sql`delete from public.maintenance_records where tenant_id in ${sql(ts)}`
  await sql`delete from public.traffic_fines where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.fuel_logs enable trigger no_editar_combustible')
  await sql.unsafe('alter table public.maintenance_records enable trigger no_editar_mantenimiento')
  await sql.unsafe('alter table public.traffic_fines enable trigger no_editar_multa_resuelta')
  await sql`delete from public.vehicle_documents where tenant_id in ${sql(ts)}`
  await sql`delete from public.vehicles where tenant_id in ${sql(ts)}`
  await sql`delete from public.employees where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio vehiculo normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.vehicles`,
    )
    expect(filas).toHaveLength(1)
  })

  it('B no ve el vehiculo de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.vehicles where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un vehiculo con el conductor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.vehicles (tenant_id, plate, brand, model, assigned_driver_id)
          values (${tenantB}, 'X999999', 'Ford', 'Ranger', ${empleadoA})`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un documento con el vehiculo de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.vehicle_documents (tenant_id, vehicle_id, doc_type, expiry_date)
          values (${tenantB}, ${vehiculoA}, 'license', '2027-01-01')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar combustible con el vehiculo o el conductor de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.fuel_logs (tenant_id, vehicle_id, liters, cost, odometer_km)
          values (${tenantB}, ${vehiculoA}, 40, 3000, 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)

    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.fuel_logs (tenant_id, vehicle_id, driver_id, liters, cost, odometer_km)
          values (${tenantB}, ${vehiculoB}, ${empleadoA}, 40, 3000, 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un mantenimiento con el vehiculo de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.maintenance_records (tenant_id, vehicle_id, type, description, odometer_km)
          values (${tenantB}, ${vehiculoA}, 'preventive', 'Cambio de aceite', 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar una multa con el vehiculo de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.traffic_fines (tenant_id, vehicle_id, amount, reason)
          values (${tenantB}, ${vehiculoA}, 1000, 'Exceso de velocidad')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Un vehiculo es un registro vivo; combustible y mantenimiento son inmutables; una multa es editable solo mientras no este resuelta', () => {
  let carga: string
  let servicio: string
  let multa: string

  it('el vehiculo SI se puede editar -actualizar el kilometraje, por ejemplo-', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.vehicles set odometer_km = 5000 where id = ${vehiculoB}`,
    )
    const [row] = await sql`select odometer_km::text from public.vehicles where id = ${vehiculoB}`
    expect(row!.odometer_km).toBe('5000.0')
  })

  it('la carga de combustible nunca se puede editar', async () => {
    const [c] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.fuel_logs (tenant_id, vehicle_id, driver_id, liters, cost, odometer_km)
        values (${tenantB}, ${vehiculoB}, ${empleadoB}, 40, 3000, 5000) returning id`,
    )
    carga = c!.id
    await expect(
      as(userB, tenantB, (tx) => tx`update public.fuel_logs set liters = 50 where id = ${carga}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('el mantenimiento nunca se puede editar', async () => {
    const [s] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.maintenance_records (tenant_id, vehicle_id, type, description, odometer_km)
        values (${tenantB}, ${vehiculoB}, 'preventive', 'Cambio de aceite', 5000) returning id`,
    )
    servicio = s!.id
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`update public.maintenance_records set cost = 999 where id = ${servicio}`,
      ),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('una multa pendiente SI se puede editar', async () => {
    const [m] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.traffic_fines (tenant_id, vehicle_id, driver_id, amount, reason)
        values (${tenantB}, ${vehiculoB}, ${empleadoB}, 2000, 'Exceso de velocidad') returning id`,
    )
    multa = m!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.traffic_fines set status = 'disputed' where id = ${multa}`,
    )
    const [row] = await sql`select status from public.traffic_fines where id = ${multa}`
    expect(row!.status).toBe('disputed')
  })

  it('una vez pagada o descartada, la multa ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.traffic_fines set status = 'paid', resolved_at = now() where id = ${multa}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.traffic_fines set amount = 1 where id = ${multa}`),
    ).rejects.toThrow(/ya quedo resuelta/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'fleet', true))

  it('sin el modulo, los vehiculos dan cero filas', async () => {
    await modulo(tenantB, 'fleet', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.vehicles`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('la misma placa no se repite para el mismo cliente', async () => {
    await expect(
      sql`insert into public.vehicles (tenant_id, plate, brand, model) values (${tenantA}, 'A123456', 'Otra', 'Marca')`,
    ).rejects.toThrow(/duplicate key|violates unique constraint/)
  })

  it('un estado de vehiculo inventado se rechaza', async () => {
    await expect(
      sql`insert into public.vehicles (tenant_id, plate, brand, model, status) values (${tenantA}, 'ZZZ999', 'X', 'Y', 'vendido')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un monto de multa de cero o negativo se rechaza', async () => {
    await expect(
      sql`insert into public.traffic_fines (tenant_id, vehicle_id, amount, reason) values (${tenantA}, ${vehiculoA}, 0, 'x')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
