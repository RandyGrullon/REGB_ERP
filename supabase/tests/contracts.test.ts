import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Contratos & Suscripciones (modulo 33, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un contrato con el cliente o el contrato
 *     anterior de A usando su PROPIO tenant_id. Mismo patron que
 *     0031-0081.
 *  3. En draft los terminos son editables; fuera de draft se
 *     congelan.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let clienteA: string
let clienteB: string
let contratoA: string

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
    values (${`ct-a-${RUN}`}, 'Servicios CT A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ct-b-${RUN}`}, 'Servicios CT B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'contracts', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantA}, 'Cliente A', 30) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms) values (${tenantB}, 'Cliente B', 30) returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [k] = await sql`
    insert into public.contracts (tenant_id, contract_number, customer_id, billing_frequency, start_date, end_date, base_amount)
    values (${tenantA}, 'CTR-0001', ${clienteA}, 'monthly', current_date, current_date + 365, 5000) returning id`
  contratoA = k!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.contracts disable trigger no_editar_contrato_activo')
  await sql`delete from public.contracts where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.contracts enable trigger no_editar_contrato_activo')
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio contrato normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.contracts`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el contrato de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.contracts where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un contrato con el cliente de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.contracts (tenant_id, contract_number, customer_id, billing_frequency, start_date, end_date, base_amount)
          values (${tenantB}, 'X', ${clienteA}, 'monthly', current_date, current_date + 30, 100)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })

  it('B no puede colar un contrato con el anterior de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.contracts (tenant_id, contract_number, customer_id, renewed_from_id, billing_frequency, start_date, end_date, base_amount)
          values (${tenantB}, 'Y', ${clienteB}, ${contratoA}, 'monthly', current_date, current_date + 30, 100)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('En draft los terminos son editables; fuera de draft se congelan', () => {
  let contrato: string

  it('en draft, el monto y las fechas son editables', async () => {
    const [k] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.contracts (tenant_id, contract_number, customer_id, billing_frequency, start_date, end_date, base_amount)
        values (${tenantB}, 'CTR-B-1', ${clienteB}, 'monthly', current_date, current_date + 365, 1000) returning id`,
    )
    contrato = k!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.contracts set base_amount = 1500 where id = ${contrato}`,
    )
    const [row] = await sql`select base_amount::text from public.contracts where id = ${contrato}`
    expect(row!.base_amount).toBe('1500.00')
  })

  it('al activarlo, los terminos ya no se pueden cambiar', async () => {
    await as(userB, tenantB, (tx) => tx`update public.contracts set status = 'active' where id = ${contrato}`)
    await expect(
      as(userB, tenantB, (tx) => tx`update public.contracts set base_amount = 999 where id = ${contrato}`),
    ).rejects.toThrow(/sus terminos no se pueden cambiar/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'contracts', true))

  it('sin el modulo, los contratos dan cero filas', async () => {
    await modulo(tenantB, 'contracts', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.contracts`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una fecha de fin antes que la de inicio se rechaza', async () => {
    await expect(
      sql`insert into public.contracts (tenant_id, contract_number, customer_id, billing_frequency, start_date, end_date, base_amount)
        values (${tenantA}, 'Z', ${clienteA}, 'monthly', current_date, current_date - 1, 100)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo numero de contrato no se repite para el mismo cliente', async () => {
    await expect(
      sql`insert into public.contracts (tenant_id, contract_number, customer_id, billing_frequency, start_date, end_date, base_amount)
        values (${tenantA}, 'CTR-0001', ${clienteA}, 'monthly', current_date, current_date + 30, 100)`,
    ).rejects.toThrow(/duplicate key/)
  })
})
