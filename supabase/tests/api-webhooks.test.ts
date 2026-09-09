import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * API & Webhooks (modulo 89, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una entrega con el endpoint/evento de A usando
 *     su PROPIO tenant_id. Mismo patron que 0031-0090.
 *  3. Una llave revocada no se puede reactivar; una entrega es
 *     inmutable desde el insert.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let endpointA: string
let endpointB: string
let eventoA: string
let eventoB: string

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
    values (${`api-a-${RUN}`}, 'API A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`api-b-${RUN}`}, 'API B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'api-webhooks', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ea] = await sql`
    insert into public.webhook_endpoints (tenant_id, url, event_types, secret)
    values (${tenantA}, 'https://a.example.do/hook', '{"crm.lead.qualified"}', 'sec-a') returning id`
  const [eb] = await sql`
    insert into public.webhook_endpoints (tenant_id, url, event_types, secret)
    values (${tenantB}, 'https://b.example.do/hook', '{"crm.lead.qualified"}', 'sec-b') returning id`
  endpointA = ea!.id
  endpointB = eb!.id

  const [va] = await sql`
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (${tenantA}, 'crm.lead.qualified', '{}'::jsonb, 'crm') returning id`
  const [vb] = await sql`
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (${tenantB}, 'crm.lead.qualified', '{}'::jsonb, 'crm') returning id`
  eventoA = va!.id
  eventoB = vb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.webhook_deliveries disable trigger no_editar_entrega')
  await sql`delete from public.webhook_deliveries where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.webhook_deliveries enable trigger no_editar_entrega')
  await sql`delete from public.webhook_endpoints where tenant_id in ${sql(ts)}`
  await sql`delete from public.api_keys where tenant_id in ${sql(ts)}`
  await sql`delete from public.event_outbox where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propio endpoint normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.webhook_endpoints`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve el endpoint de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.webhook_endpoints where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una entrega con el endpoint de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.webhook_deliveries (tenant_id, endpoint_id, event_id, success)
          values (${tenantB}, ${endpointA}, ${eventoB}, true)`,
      ),
    ).rejects.toThrow(/no pertenecen a esta cuenta/)
  })

  it('B no puede colar una entrega con el evento de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.webhook_deliveries (tenant_id, endpoint_id, event_id, success)
          values (${tenantB}, ${endpointB}, ${eventoA}, true)`,
      ),
    ).rejects.toThrow(/no pertenecen a esta cuenta/)
  })
})

describe('Llave revocada es terminal; entrega inmutable desde el insert', () => {
  let llave: string

  it('una llave activa se puede revocar', async () => {
    const [k] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.api_keys (tenant_id, name, key_prefix, key_hash)
        values (${tenantB}, 'Llave B', 'regb_ab12', 'hash-b') returning id`,
    )
    llave = k!.id
    await as(userB, tenantB, (tx) => tx`update public.api_keys set status = 'revoked', revoked_at = now() where id = ${llave}`)
    const [row] = await sql`select status from public.api_keys where id = ${llave}`
    expect(row!.status).toBe('revoked')
  })

  it('una llave revocada no se puede reactivar', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.api_keys set status = 'active' where id = ${llave}`),
    ).rejects.toThrow(/no se puede reactivar/)
  })

  it('una entrega se registra normalmente pero nunca se puede editar', async () => {
    const [d] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.webhook_deliveries (tenant_id, endpoint_id, event_id, status_code, success)
        values (${tenantB}, ${endpointB}, ${eventoB}, 200, true) returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.webhook_deliveries set success = false where id = ${d!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('el mismo endpoint no entrega el mismo evento dos veces', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.webhook_deliveries (tenant_id, endpoint_id, event_id, success)
          values (${tenantB}, ${endpointB}, ${eventoB}, true)`,
      ),
    ).rejects.toThrow(/duplicate key/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'api-webhooks', true))

  it('sin el modulo, los endpoints dan cero filas', async () => {
    await modulo(tenantB, 'api-webhooks', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.webhook_endpoints`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un endpoint sin ningun tipo de evento se rechaza', async () => {
    await expect(
      sql`insert into public.webhook_endpoints (tenant_id, url, event_types, secret)
        values (${tenantA}, 'https://x.example.do', '{}', 'sec-x')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo hash de llave no se repite entre tenants', async () => {
    await sql`insert into public.api_keys (tenant_id, name, key_prefix, key_hash) values (${tenantA}, 'K1', 'regb_x', 'hash-unico')`
    await expect(
      sql`insert into public.api_keys (tenant_id, name, key_prefix, key_hash) values (${tenantB}, 'K2', 'regb_y', 'hash-unico')`,
    ).rejects.toThrow(/duplicate key/)
  })
})
