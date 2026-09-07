import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Multimoneda (modulo 26, F6) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base directamente:
 *
 *  1. Aislamiento normal entre clientes -las tasas SI son por tenant,
 *     aunque las monedas sean un catalogo global-.
 *  2. El catalogo de monedas es de lectura publica para cualquier
 *     autenticado, sin importar el tenant.
 *  3. DOP nunca necesita su propia tasa -se rechaza explicitamente-.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string

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
    values (${`mc-a-${RUN}`}, 'Ferreteria MC A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`mc-b-${RUN}`}, 'Distribuidora MC B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'multicurrency', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  await sql`
    insert into public.exchange_rates (tenant_id, currency_code, rate_date, rate)
    values (${tenantA}, 'USD', current_date, 58.50)`
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.exchange_rates where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('El catalogo de monedas es global', () => {
  it('cualquier tenant autenticado ve las mismas monedas', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ code: string }[]>`select code from public.currencies order by code`,
    )
    expect(filas.map((f) => f.code)).toEqual(['DOP', 'EUR', 'USD'])
  })
})

describe('Aislamiento entre clientes en las tasas', () => {
  it('A ve su propia tasa normalmente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ rate: string }[]>`select rate::text from public.exchange_rates`,
    )
    expect(filas.map((f) => Number(f.rate))).toEqual([58.5])
  })

  it('B no ve la tasa de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.exchange_rates where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B captura su propia tasa sin ver la de A', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`
        insert into public.exchange_rates (tenant_id, currency_code, rate_date, rate)
        values (${tenantB}, 'USD', current_date, 59.10)`,
    )
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ rate: string }[]>`select rate::text from public.exchange_rates`,
    )
    expect(filas.map((f) => Number(f.rate))).toEqual([59.1])
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantA, 'multicurrency', true))

  it('sin el modulo, las tasas dan cero filas', async () => {
    await modulo(tenantA, 'multicurrency', false)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.exchange_rates`,
    )
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('DOP no puede tener su propia tasa', async () => {
    await expect(
      sql`
        insert into public.exchange_rates (tenant_id, currency_code, rate_date, rate)
        values (${tenantA}, 'DOP', current_date, 1)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una tasa de cero o negativa se rechaza', async () => {
    await expect(
      sql`
        insert into public.exchange_rates (tenant_id, currency_code, rate_date, rate)
        values (${tenantA}, 'EUR', current_date, 0)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('la misma moneda no se repite en el mismo dia para el mismo cliente', async () => {
    await expect(
      sql`
        insert into public.exchange_rates (tenant_id, currency_code, rate_date, rate)
        values (${tenantA}, 'USD', current_date, 58.60)`,
    ).rejects.toThrow(/duplicate key/)
  })
})
