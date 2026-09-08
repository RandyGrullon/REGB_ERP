import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Marketing & Campanas (modulo 37, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un destinatario con la campana o el lead de A
 *     usando su PROPIO tenant_id. Mismo patron que 0031-0086.
 *  3. Una campana es editable hasta resolverse (enviada/cancelada);
 *     un destinatario es inmutable en quien/cuando se envio, pero
 *     abrir/clic si se pueden rellenar despues.
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
let leadB2: string
let campanaA: string

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
    values (${`mkt-a-${RUN}`}, 'Marketing A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`mkt-b-${RUN}`}, 'Marketing B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'crm', 'active', true), (${t}, 'marketing', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [la] = await sql`
    insert into public.leads (tenant_id, name, source) values (${tenantA}, 'Lead A', 'web') returning id`
  const [lb] = await sql`
    insert into public.leads (tenant_id, name, source) values (${tenantB}, 'Lead B', 'web') returning id`
  const [lb2] = await sql`
    insert into public.leads (tenant_id, name, source) values (${tenantB}, 'Lead B2', 'web') returning id`
  leadA = la!.id
  leadB = lb!.id
  leadB2 = lb2!.id

  const [ca] = await sql`
    insert into public.campaigns (tenant_id, name, channel, message) values (${tenantA}, 'Campana A', 'email', 'Hola') returning id`
  campanaA = ca!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.campaign_recipients disable trigger no_borrar_destinatario')
  await sql`delete from public.campaign_recipients where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.campaign_recipients enable trigger no_borrar_destinatario')
  await sql.unsafe('alter table public.campaigns disable trigger no_editar_campana_resuelta')
  await sql`delete from public.campaigns where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.campaigns enable trigger no_editar_campana_resuelta')
  await sql`delete from public.leads where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia campana normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.campaigns`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la campana de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.campaigns where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un destinatario con la campana de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.campaign_recipients (tenant_id, campaign_id, lead_id)
          values (${tenantB}, ${campanaA}, ${leadB})`,
      ),
    ).rejects.toThrow(/no pertenecen a esta cuenta/)
  })

  it('B no puede colar un destinatario con el lead de A usando su PROPIO tenant_id', async () => {
    const [propia] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.campaigns (tenant_id, name, channel, message)
        values (${tenantB}, 'Campana B', 'whatsapp', 'Hola') returning id`,
    )
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.campaign_recipients (tenant_id, campaign_id, lead_id)
          values (${tenantB}, ${propia!.id}, ${leadA})`,
      ),
    ).rejects.toThrow(/no pertenecen a esta cuenta/)
  })
})

describe('Editable hasta resolverse; destinatario inmutable en quien/cuando, abrir-clic si avanzan', () => {
  let campana: string
  let destinatario: string

  it('en borrador, el mensaje y el estado son editables', async () => {
    const [c] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.campaigns (tenant_id, name, channel, message)
        values (${tenantB}, 'Promo B', 'email', 'Version 1') returning id`,
    )
    campana = c!.id
    await as(userB, tenantB, (tx) => tx`update public.campaigns set message = 'Version 2' where id = ${campana}`)
    await as(userB, tenantB, (tx) => tx`update public.campaigns set status = 'scheduled' where id = ${campana}`)
    const [row] = await sql`select message, status from public.campaigns where id = ${campana}`
    expect(row!.message).toBe('Version 2')
    expect(row!.status).toBe('scheduled')
  })

  it('un destinatario se registra normalmente; abrir y clic se pueden rellenar despues', async () => {
    const [d] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.campaign_recipients (tenant_id, campaign_id, lead_id)
        values (${tenantB}, ${campana}, ${leadB}) returning id`,
    )
    destinatario = d!.id
    await as(userB, tenantB, (tx) => tx`update public.campaign_recipients set opened_at = now() where id = ${destinatario}`)
    const [row] = await sql`select opened_at from public.campaign_recipients where id = ${destinatario}`
    expect(row!.opened_at).not.toBeNull()
  })

  it('un destinatario no puede cambiar de lead', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`update public.campaign_recipients set lead_id = ${leadB2} where id = ${destinatario}`),
    ).rejects.toThrow(/no cambia de campana, lead ni fecha de envio/)
  })

  it('marcarla enviada la congela', async () => {
    await as(userB, tenantB, (tx) => tx`update public.campaigns set status = 'sent', sent_at = now() where id = ${campana}`)
    await expect(
      as(userB, tenantB, (tx) => tx`update public.campaigns set message = 'x' where id = ${campana}`),
    ).rejects.toThrow(/ya se resolvio y no se edita/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'marketing', true))

  it('sin el modulo, las campanas dan cero filas', async () => {
    await modulo(tenantB, 'marketing', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.campaigns`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un canal inventado se rechaza', async () => {
    await expect(
      sql`insert into public.campaigns (tenant_id, name, channel, message)
        values (${tenantA}, 'x', 'sms', 'x')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo lead no se repite dos veces como destinatario de la misma campana', async () => {
    await sql.unsafe('alter table public.campaigns disable trigger no_editar_campana_resuelta')
    await expect(
      sql`insert into public.campaign_recipients (tenant_id, campaign_id, lead_id) values (${tenantA}, ${campanaA}, ${leadA})`,
    ).resolves.toBeDefined()
    await expect(
      sql`insert into public.campaign_recipients (tenant_id, campaign_id, lead_id) values (${tenantA}, ${campanaA}, ${leadA})`,
    ).rejects.toThrow(/duplicate key/)
    await sql.unsafe('alter table public.campaigns enable trigger no_editar_campana_resuelta')
  })
})
