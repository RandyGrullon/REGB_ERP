import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Firma electronica (modulo 91, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un evento con la solicitud de A usando su
 *     PROPIO tenant_id. Mismo patron que 0031-0080.
 *  3. Una solicitud es editable hasta resolverse (signed/declined/
 *     expired); un evento es inmutable desde el primer insert.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let solicitudA: string

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
    values (${`es-a-${RUN}`}, 'Firma ES A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`es-b-${RUN}`}, 'Firma ES B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'e-sign', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [sa] = await sql`
    insert into public.signature_requests (tenant_id, document_type, document_id, document_label, signer_name, signer_email)
    values (${tenantA}, 'quote', ${crypto.randomUUID()}, 'COT-0001 v1', 'Firmante A', 'a@example.do') returning id`
  solicitudA = sa!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.signature_events disable trigger no_editar_evento')
  await sql`delete from public.signature_events where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.signature_events enable trigger no_editar_evento')
  await sql.unsafe('alter table public.signature_requests disable trigger no_editar_solicitud_resuelta')
  await sql`delete from public.signature_requests where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.signature_requests enable trigger no_editar_solicitud_resuelta')
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia solicitud normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.signature_requests`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la solicitud de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.signature_requests where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un evento con la solicitud de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.signature_events (tenant_id, request_id, event_type)
          values (${tenantB}, ${solicitudA}, 'created')`,
      ),
    ).rejects.toThrow(/no pertenece a esta cuenta/)
  })
})

describe('Solicitud editable hasta resolverse; evento inmutable desde el insert', () => {
  let solicitud: string

  it('pendiente, se puede enviar y editar', async () => {
    const [s] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.signature_requests (tenant_id, document_type, document_id, document_label, signer_name, signer_email)
        values (${tenantB}, 'quote', ${crypto.randomUUID()}, 'COT-0002 v1', 'Firmante B', 'b@example.do') returning id`,
    )
    solicitud = s!.id
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.signature_requests set status = 'sent', sent_at = now() where id = ${solicitud}`,
    )
    const [row] = await sql`select status from public.signature_requests where id = ${solicitud}`
    expect(row!.status).toBe('sent')
  })

  it('un evento se registra normalmente pero nunca se puede editar', async () => {
    const [e] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.signature_events (tenant_id, request_id, event_type)
        values (${tenantB}, ${solicitud}, 'sent') returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.signature_events set event_type = 'signed' where id = ${e!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('firmada, la solicitud ya no se puede editar', async () => {
    await as(
      userB,
      tenantB,
      (tx) => tx`update public.signature_requests set status = 'signed', signed_at = now() where id = ${solicitud}`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.signature_requests set signer_email = 'x@x.do' where id = ${solicitud}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'e-sign', true))

  it('sin el modulo, las solicitudes dan cero filas', async () => {
    await modulo(tenantB, 'e-sign', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.signature_requests`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un tipo de documento inventado se rechaza', async () => {
    await expect(
      sql`insert into public.signature_requests (tenant_id, document_type, document_id, document_label, signer_name, signer_email)
        values (${tenantA}, 'invalido', ${crypto.randomUUID()}, 'x', 'x', 'x@x.do')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un tipo de evento inventado se rechaza', async () => {
    await expect(
      sql`insert into public.signature_events (tenant_id, request_id, event_type)
        values (${tenantA}, ${solicitudA}, 'invalido')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
