/**
 * Tests de dunning e impersonacion (S17) contra Postgres real.
 *
 * La puerta F3 exige dos cosas verificadas con test:
 *  - "Ningun paso de dunning borra datos" — se cuenta TODO antes y despues.
 *  - La impersonacion exige razon, expira a los 60 min y queda en el log
 *    de AMBOS lados (regb.impersonation_log + audit.log del tenant).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const providerUser = crypto.randomUUID()
let tenant: string

const LINES = JSON.stringify([{ label: 'Base mensual', amount: 79 }])

/** Factura vencida hace `days` dias. */
async function overdueInvoice(days: number, period: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into regb.invoices
      (tenant_id, number, period_start, period_end, subtotal, discount, tax,
       total, currency, status, due_at, lines)
    values
      (${tenant}, regb.next_invoice_number(), ${period},
       (${period}::date + interval '1 month' - interval '1 day')::date,
       79, 0, 0, 79, 'USD', 'sent',
       (current_date - ${days}::integer)::date, ${LINES}::jsonb)
    returning id`
  return row!.id
}

async function totalRows(): Promise<Record<string, number>> {
  const [r] = await sql<Record<string, string>[]>`
    select
      (select count(*) from regb.tenants)          as tenants,
      (select count(*) from regb.invoices)          as invoices,
      (select count(*) from regb.tenant_modules)    as modules,
      (select count(*) from regb.subscriptions)     as subs,
      (select count(*) from public.companies)       as companies,
      (select count(*) from public.roles)           as roles`
  return Object.fromEntries(Object.entries(r!).map(([k, v]) => [k, Number(v)]))
}

beforeAll(async () => {
  const [t] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`dun-${RUN}`}, 'Moroso SRL', 'pyme', 'active') returning id`
  tenant = t!.id
})

afterAll(async () => {
  await sql`delete from regb.dunning_log where tenant_id = ${tenant}`
  await sql`delete from regb.impersonation_log where tenant_id = ${tenant}`
  await sql`delete from regb.payment_attempts where invoice_id in
    (select id from regb.invoices where tenant_id = ${tenant})`
  await sql`delete from audit.log where tenant_id = ${tenant}`
  await sql`delete from regb.invoices where tenant_id = ${tenant}`
  await sql`delete from regb.tenants where id = ${tenant}`
  await sql.end()
})

describe('apply_dunning', () => {
  it('degrada segun la factura impaga mas vieja y NO borra ni una fila', async () => {
    await overdueInvoice(17, '2098-01-01')
    const antes = await totalRows()

    await sql`select * from regb.apply_dunning()`

    const [t] = await sql<{ status: string }[]>`
      select status from regb.tenants where id = ${tenant}`
    expect(t!.status).toBe('readonly') // 17 dias -> dia 15: solo lectura

    const despues = await totalRows()
    expect(despues).toEqual(antes) // la regla sagrada: nada se borro
  })

  it('es idempotente: correrlo otra vez no re-registra pasos ni cambia nada', async () => {
    await sql`select * from regb.apply_dunning()`
    await sql`select * from regb.apply_dunning()`

    const steps = await sql<{ step: string }[]>`
      select step from regb.dunning_log where tenant_id = ${tenant}`
    // Registra el peldano VIGENTE (dia 17 -> readonly), una sola vez aunque
    // se corra mil veces. Los peldanos anteriores se registran el dia que
    // ocurren cuando el cron corre a diario; aqui se salto directo al 17.
    expect(steps.map((s) => s.step)).toEqual(['readonly'])
  })

  it('al pagar todo, el cliente se recupera a activo — sin tocar a nadie mas', async () => {
    const [inv] = await sql<{ id: string }[]>`
      select id from regb.invoices where tenant_id = ${tenant} and status = 'overdue'`
    await sql`select regb.record_payment(${inv!.id}, ${`dun-pay-${RUN}`}, 'manual')`

    await sql`select * from regb.apply_dunning()`

    const [t] = await sql<{ status: string }[]>`
      select status from regb.tenants where id = ${tenant}`
    expect(t!.status).toBe('active')
  })

  it('a los 90 dias archiva, y archivado no revive solo', async () => {
    await overdueInvoice(95, '2098-02-01')
    await sql`select * from regb.apply_dunning()`

    const [t] = await sql<{ status: string }[]>`
      select status from regb.tenants where id = ${tenant}`
    expect(t!.status).toBe('archived')

    // Paga... pero archivado requiere reactivacion manual del proveedor.
    const [inv] = await sql<{ id: string }[]>`
      select id from regb.invoices where tenant_id = ${tenant} and status = 'overdue'`
    await sql`select regb.record_payment(${inv!.id}, ${`dun-pay2-${RUN}`}, 'manual')`
    await sql`select * from regb.apply_dunning()`

    const [after] = await sql<{ status: string }[]>`
      select status from regb.tenants where id = ${tenant}`
    expect(after!.status).toBe('archived')
  })
})

describe('impersonacion (§7.4)', () => {
  it('sin razon de 10+ caracteres no arranca', async () => {
    await expect(
      sql`select regb.start_impersonation(${providerUser}, ${tenant}, 'corta')`,
    ).rejects.toThrow(/razon es obligatoria/)
  })

  it('deja rastro en AMBOS lados: log del proveedor y bitacora del tenant', async () => {
    await sql`select regb.start_impersonation(
      ${providerUser}, ${tenant}, 'Soporte ticket #4512: revisar factura duplicada', 'T-4512')`

    const [prov] = await sql<{ c: string }[]>`
      select count(*) as c from regb.impersonation_log
      where provider_user = ${providerUser} and tenant_id = ${tenant} and ended_at is null`
    expect(Number(prov!.c)).toBe(1)

    const [aud] = await sql<{ c: string }[]>`
      select count(*) as c from audit.log
      where tenant_id = ${tenant} and action = 'impersonate'`
    expect(Number(aud!.c)).toBe(1)
  })

  it('una nueva sesion cierra la anterior: solo una abierta por usuario', async () => {
    await sql`select regb.start_impersonation(
      ${providerUser}, ${tenant}, 'Soporte ticket #4513: seguimiento del caso anterior')`

    const [open] = await sql<{ c: string }[]>`
      select count(*) as c from regb.impersonation_log
      where provider_user = ${providerUser} and ended_at is null`
    expect(Number(open!.c)).toBe(1)
  })

  it('end_impersonation cierra la sesion', async () => {
    await sql`select regb.end_impersonation(${providerUser})`
    const [open] = await sql<{ c: string }[]>`
      select count(*) as c from regb.impersonation_log
      where provider_user = ${providerUser} and ended_at is null`
    expect(Number(open!.c)).toBe(0)
  })

  it('rls.impersonating() considera vencida una sesion de mas de 60 min', async () => {
    await sql`select regb.start_impersonation(
      ${providerUser}, ${tenant}, 'Soporte ticket #4514: prueba de expiracion')`
    await sql`update regb.impersonation_log
      set started_at = now() - interval '61 minutes'
      where provider_user = ${providerUser} and ended_at is null`

    // Como usuario del proveedor con claims: la sesion vencida ya no cuenta.
    const claims = JSON.stringify({
      sub: providerUser,
      app_metadata: { tenant_id: null, is_provider: true },
    })
    const vigente = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`
      await tx.unsafe('set local role authenticated')
      const [r] = await tx<{ ok: boolean }[]>`select rls.impersonating(${tenant}) as ok`
      return r!.ok
    })
    expect(vigente).toBe(false)
  })
})
