import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Activos fijos (modulo 21, F6) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una depreciacion ni un revaluo en un activo de A
 *     usando su PROPIO tenant_id. Mismo patron que 0040/0041/0044/0045.
 *  3. run_fixed_asset_depreciation() es idempotente: correrla dos veces
 *     para el mismo periodo no duplica el gasto.
 *  4. Los tres registros (depreciacion, revaluo, activo dado de baja)
 *     quedan inmutables.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let activoA: string
let activoB: string

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
    values (${`fa-a-${RUN}`}, 'Ferreteria FA A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`fa-b-${RUN}`}, 'Distribuidora FA B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'fixed-assets', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [aa] = await sql`
    insert into public.fixed_assets
      (tenant_id, code, name, acquisition_date, acquisition_cost, useful_life_months)
    values (${tenantA}, ${`VEH-${RUN}`}, 'Camioneta de reparto', current_date - 365, 600000, 60)
    returning id`
  const [bb] = await sql`
    insert into public.fixed_assets
      (tenant_id, code, name, acquisition_date, acquisition_cost, useful_life_months)
    values (${tenantB}, ${`EQ-${RUN}`}, 'Nevera exhibidora', current_date - 100, 80000, 48)
    returning id`
  activoA = aa!.id
  activoB = bb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.fixed_asset_depreciations disable trigger no_editar_depreciacion')
  await sql.unsafe('alter table public.fixed_asset_revaluations disable trigger no_editar_revaluo')
  await sql`delete from public.fixed_asset_depreciations where tenant_id in ${sql(ts)}`
  await sql`delete from public.fixed_asset_revaluations where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.fixed_asset_depreciations enable trigger no_editar_depreciacion')
  await sql.unsafe('alter table public.fixed_asset_revaluations enable trigger no_editar_revaluo')
  await sql.unsafe('alter table public.fixed_assets disable trigger no_editar_activo_de_baja')
  await sql`delete from public.fixed_assets where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.fixed_assets enable trigger no_editar_activo_de_baja')
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('B no ve los activos de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.fixed_assets where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un revaluo en un activo de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.fixed_asset_revaluations
            (tenant_id, asset_id, old_value, new_value, reason)
          values (${tenantB}, ${activoA}, 600000, 700000, 'Avaluo ajeno')`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede colar una depreciacion en un activo de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.fixed_asset_depreciations (tenant_id, asset_id, period_date, amount)
          values (${tenantB}, ${activoA}, current_date, 1000)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede revaluar el activo de A llamando a la funcion con su propia sesion', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`select public.revalue_fixed_asset(${activoA}, 700000, 'Intento ajeno')`),
    ).rejects.toThrow(/no es de este cliente/)
  })

  it('la camioneta de A existe y es suya: aislar no puede romper lo propio', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.fixed_assets`,
    )
    expect(filas.map((f) => f.id)).toEqual([activoA])
  })

  it('B revalua normalmente SU propia nevera sin que el aislamiento se lo impida', async () => {
    await as(userB, tenantB, (tx) =>
      tx`select public.revalue_fixed_asset(${activoB}, 90000, 'Se le agrego un compresor nuevo')`,
    )
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ base: string }[]>`select public.fixed_asset_current_basis(${activoB})::text as base`,
    )
    expect(Number(r!.base)).toBe(90000)
  })
})

describe('Correr la depreciacion', () => {
  const periodo = new Date().toISOString().slice(0, 10)

  it('genera un registro para el activo activo', async () => {
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ n: string }[]>`
        select public.run_fixed_asset_depreciation(${tenantA}, ${periodo})::text as n`,
    )
    expect(Number(r!.n)).toBe(1)

    const [dep] = await sql<{ amount: string }[]>`
      select amount::text from public.fixed_asset_depreciations
      where asset_id = ${activoA} and period_date = ${periodo}`
    // 600000 / 60 meses = 10000 exacto
    expect(Number(dep!.amount)).toBe(10000)
  })

  it('correrla de nuevo para el mismo periodo no duplica el gasto', async () => {
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ n: string }[]>`
        select public.run_fixed_asset_depreciation(${tenantA}, ${periodo})::text as n`,
    )
    expect(Number(r!.n)).toBe(0)

    const filas = await sql`
      select id from public.fixed_asset_depreciations
      where asset_id = ${activoA} and period_date = ${periodo}`
    expect(filas).toHaveLength(1)
  })

  it('un registro de depreciacion no se edita ni se borra', async () => {
    await expect(
      sql`update public.fixed_asset_depreciations set amount = 1 where asset_id = ${activoA}`,
    ).rejects.toThrow(/no se edita ni se borra/)
    await expect(
      sql`delete from public.fixed_asset_depreciations where asset_id = ${activoA}`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })
})

describe('Revaluo', () => {
  it('registra el revaluo y el siguiente book value lo refleja', async () => {
    await as(userA, tenantA, (tx) =>
      tx`select public.revalue_fixed_asset(${activoA}, 550000, 'Avaluo de perito por desgaste')`,
    )
    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ base: string }[]>`select public.fixed_asset_current_basis(${activoA})::text as base`,
    )
    expect(Number(r!.base)).toBe(550000)
  })

  it('un revaluo no se edita ni se borra', async () => {
    await expect(
      sql`update public.fixed_asset_revaluations set new_value = 1 where asset_id = ${activoA}`,
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('rechaza un revaluo sin motivo', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`select public.revalue_fixed_asset(${activoA}, 500000, '')`),
    ).rejects.toThrow(/motivo del revaluo/)
  })
})

describe('Dar de baja', () => {
  it('marca el activo como dado de baja', async () => {
    await as(userA, tenantA, (tx) =>
      tx`select public.dispose_fixed_asset(${activoA}, current_date, 400000, 'Vendida a un tercero')`,
    )
    const [a] = await sql<{ status: string }[]>`select status from public.fixed_assets where id = ${activoA}`
    expect(a!.status).toBe('disposed')
  })

  it('un activo dado de baja no se edita mas', async () => {
    await expect(
      sql`update public.fixed_assets set name = 'Otro nombre' where id = ${activoA}`,
    ).rejects.toThrow(/no se edita/)
  })

  it('no se puede dar de baja dos veces', async () => {
    await expect(
      as(userA, tenantA, (tx) =>
        tx`select public.dispose_fixed_asset(${activoA}, current_date, 1, 'Otra vez')`,
      ),
    ).rejects.toThrow(/ya esta dado de baja/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'fixed-assets', true))

  it('sin el modulo, los activos dan cero filas', async () => {
    await modulo(tenantB, 'fixed-assets', false)
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.fixed_assets`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('el valor de rescate no puede ser mayor que el costo', async () => {
    await expect(
      sql`
        insert into public.fixed_assets
          (tenant_id, code, name, acquisition_date, acquisition_cost, salvage_value, useful_life_months)
        values (${tenantB}, ${`BAD-${RUN}`}, 'Malo', current_date, 1000, 2000, 12)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo codigo no se puede repetir para el mismo cliente', async () => {
    await expect(
      sql`
        insert into public.fixed_assets
          (tenant_id, code, name, acquisition_date, acquisition_cost, useful_life_months)
        values (${tenantB}, ${`EQ-${RUN}`}, 'Duplicada', current_date, 1000, 12)`,
    ).rejects.toThrow(/duplicate key/)
  })
})
