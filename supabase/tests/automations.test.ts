import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Automatizaciones (modulo 88, F9) contra Postgres real.
 *
 * Cubre lo que solo se puede comprobar hablandole a la base
 * directamente:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar una ejecucion con la regla/evento de A usando
 *     su PROPIO tenant_id. Mismo patron que 0031-0089.
 *  3. Una regla es editable en todo momento; una ejecucion es
 *     inmutable desde el insert, y (regla, evento) no se repite.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let reglaA: string
let reglaB: string
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
    values (${`aut-a-${RUN}`}, 'Automatizaciones A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`aut-b-${RUN}`}, 'Automatizaciones B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'automations', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ra] = await sql`
    insert into public.automation_rules (tenant_id, name, trigger_event_type, action_type)
    values (${tenantA}, 'Regla A', 'helpdesk.ticket.resolved', 'create_notification') returning id`
  const [rb] = await sql`
    insert into public.automation_rules (tenant_id, name, trigger_event_type, action_type)
    values (${tenantB}, 'Regla B', 'helpdesk.ticket.resolved', 'create_notification') returning id`
  reglaA = ra!.id
  reglaB = rb!.id

  const [ea] = await sql`
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (${tenantA}, 'helpdesk.ticket.resolved', '{}'::jsonb, 'helpdesk') returning id`
  const [eb] = await sql`
    insert into public.event_outbox (tenant_id, type, payload, emitted_by)
    values (${tenantB}, 'helpdesk.ticket.resolved', '{}'::jsonb, 'helpdesk') returning id`
  eventoA = ea!.id
  eventoB = eb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql.unsafe('alter table public.automation_runs disable trigger no_editar_ejecucion')
  await sql`delete from public.automation_runs where tenant_id in ${sql(ts)}`
  await sql.unsafe('alter table public.automation_runs enable trigger no_editar_ejecucion')
  await sql`delete from public.automation_rules where tenant_id in ${sql(ts)}`
  await sql`delete from public.event_outbox where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('A ve su propia regla normalmente', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ id: string }[]>`select id from public.automation_rules`)
    expect(filas).toHaveLength(1)
  })

  it('B no ve la regla de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.automation_rules where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar una ejecucion con la regla de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.automation_runs (tenant_id, rule_id, event_id, matched)
          values (${tenantB}, ${reglaA}, ${eventoB}, true)`,
      ),
    ).rejects.toThrow(/no pertenecen a esta cuenta/)
  })

  it('B no puede colar una ejecucion con el evento de A usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.automation_runs (tenant_id, rule_id, event_id, matched)
          values (${tenantB}, ${reglaB}, ${eventoA}, true)`,
      ),
    ).rejects.toThrow(/no pertenecen a esta cuenta/)
  })
})

describe('Regla editable en todo momento; ejecucion inmutable desde el insert', () => {
  it('una regla activa se puede pausar y editar', async () => {
    await as(userB, tenantB, (tx) => tx`update public.automation_rules set status = 'paused' where id = ${reglaB}`)
    const [row] = await sql`select status from public.automation_rules where id = ${reglaB}`
    expect(row!.status).toBe('paused')
  })

  it('una ejecucion se registra normalmente pero nunca se puede editar', async () => {
    const [r] = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        insert into public.automation_runs (tenant_id, rule_id, event_id, matched, action_result)
        values (${tenantB}, ${reglaB}, ${eventoB}, true, '{"notificationId":"x"}'::jsonb) returning id`,
    )
    await expect(
      as(userB, tenantB, (tx) => tx`update public.automation_runs set matched = false where id = ${r!.id}`),
    ).rejects.toThrow(/no se edita ni se borra/)
  })

  it('la misma regla no procesa el mismo evento dos veces', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.automation_runs (tenant_id, rule_id, event_id, matched)
          values (${tenantB}, ${reglaB}, ${eventoB}, true)`,
      ),
    ).rejects.toThrow(/duplicate key/)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantB, 'automations', true))

  it('sin el modulo, las reglas dan cero filas', async () => {
    await modulo(tenantB, 'automations', false)
    const filas = await as(userB, tenantB, (tx) => tx<{ id: string }[]>`select id from public.automation_rules`)
    expect(filas).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un tipo de evento que no siga modulo.entidad.accion se rechaza', async () => {
    await expect(
      sql`insert into public.automation_rules (tenant_id, name, trigger_event_type, action_type)
        values (${tenantA}, 'x', 'invalido', 'create_notification')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una accion inventada se rechaza', async () => {
    await expect(
      sql`insert into public.automation_rules (tenant_id, name, trigger_event_type, action_type)
        values (${tenantA}, 'y', 'crm.lead.qualified', 'ejecutar_codigo_libre')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('una condicion a medias (solo campo, sin operador) se rechaza', async () => {
    await expect(
      sql`insert into public.automation_rules (tenant_id, name, trigger_event_type, action_type, condition_field)
        values (${tenantA}, 'z', 'crm.lead.qualified', 'create_notification', 'priority')`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
