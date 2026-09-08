import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Oportunidades / Pipeline de ventas (modulo 30, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una oportunidad con el lead de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0078.
 *  3. Una oportunidad es editable hasta que llega a 'won'/'lost';
 *     ahi se congela.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let leadA: string
let leadB: string

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
    values (${`pl-a-${RUN}`}, 'Ventas PL A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`pl-b-${RUN}`}, 'Ventas PL B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'crm', 'active', true), (${t}, 'pipeline', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [la] = await sql`
    insert into public.leads (tenant_id, name, source) values (${tenantA}, 'Lead A', 'web') returning id`
  const [lb] = await sql`
    insert into public.leads (tenant_id, name, source) values (${tenantB}, 'Lead B', 'web') returning id`
  leadA = la!.id
  leadB = lb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.opportunities disable trigger no_editar_oportunidad_resuelta')
  await sql`delete from public.opportunities where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.opportunities enable trigger no_editar_oportunidad_resuelta')
  await sql`delete from public.leads where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia oportunidad normalmente', async () => {
    await as(
      userA,
      tenantA,
      (tx) => tx`insert into public.opportunities (tenant_id, lead_id, name, amount) values (${tenantA}, ${leadA}, 'Oportunidad A', 1000)`,
    )
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.opportunities`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la oportunidad de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.opportunities where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una oportunidad con el lead de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.opportunities (tenant_id, lead_id, name, amount)
          values (${tenantB}, ${leadA}, 'x', 500)`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Editable hasta resolverse; congelada en won/lost', () => {
  let oportunidad: string

  it('en curso, el monto y la etapa son editables', async () => {
    const [o] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.opportunities (tenant_id, lead_id, name, amount)
        values (${tenantB}, ${leadB}, 'Oportunidad B', 5000) returning id`,
    )
    oportunidad = o!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.opportunities set stage = 'qualification', amount = 6000 where id = ${oportunidad}`,
    )
    const [row] = await sql`select stage, amount::text from public.opportunities where id = ${oportunidad}`
    expect(row!.stage).toBe('qualification')
    expect(row!.amount).toBe('6000.00')
  })

  it('marcarla ganada la congela', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.opportunities set stage = 'won' where id = ${oportunidad}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.opportunities set amount = 1 where id = ${oportunidad}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'pipeline', true))

  it('sin el modulo, las oportunidades dan cero filas', async () => {
    await modulo(tenantB, 'pipeline', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.opportunities`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('marcar perdida sin motivo se rechaza', async () => {
    await expect(
      sql`insert into public.opportunities (tenant_id, lead_id, name, amount, stage)
        values (${tenantA}, ${leadA}, 'x', 100, 'lost')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una probabilidad fuera de 0-1 se rechaza', async () => {
    await expect(
      sql`insert into public.opportunities (tenant_id, lead_id, name, amount, probability)
        values (${tenantA}, ${leadA}, 'x', 100, 1.5)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
