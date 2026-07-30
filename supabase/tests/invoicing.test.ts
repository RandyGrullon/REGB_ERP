/**
 * Tests de facturacion (S16) contra Postgres real.
 *
 * El calendario de reintentos se prueba sin base de datos en
 * @regb/billing/collection.test.ts. Aqui va lo que solo un motor de
 * verdad puede garantizar: numeracion sin duplicados, una factura por
 * periodo, y que un webhook repetido jamas cobre dos veces.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 4, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userX = crypto.randomUUID()
let tenant: string

const claims = (userId: string, tenantId: string) =>
  JSON.stringify({ sub: userId, app_metadata: { tenant_id: tenantId, is_provider: false } })

async function asTenantUser<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userX, tenant)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

const LINES = JSON.stringify([{ label: 'Base mensual', detail: 'Tier pyme', amount: 79 }])

async function insertInvoice(period: string): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`
    insert into regb.invoices
      (tenant_id, number, period_start, period_end, subtotal, discount, tax,
       total, currency, status, due_at, lines)
    values
      (${tenant}, regb.next_invoice_number(), ${period},
       (${period}::date + interval '1 month' - interval '1 day')::date,
       79, 0, 0, 79, 'USD', 'sent', ${period}, ${LINES}::jsonb)
    on conflict (tenant_id, period_start) where status <> 'void' do nothing
    returning id`
  return row?.id ?? null
}

beforeAll(async () => {
  const [t] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`inv-${RUN}`}, 'Facturable SRL', 'pyme', 'active') returning id`
  tenant = t!.id
})

afterAll(async () => {
  await sql`delete from regb.payment_attempts where invoice_id in
    (select id from regb.invoices where tenant_id = ${tenant})`
  await sql`delete from regb.invoices where tenant_id = ${tenant}`
  await sql`delete from regb.tenants where id = ${tenant}`
  await sql.end()
})

describe('Numeracion', () => {
  it('emite numeros REGB-<ano>-<n> estrictamente crecientes', async () => {
    const [a] = await sql<{ n: string }[]>`select regb.next_invoice_number() as n`
    const [b] = await sql<{ n: string }[]>`select regb.next_invoice_number() as n`
    expect(a!.n).toMatch(/^REGB-\d{4}-\d{5}$/)
    const na = Number(a!.n.slice(-5))
    const nb = Number(b!.n.slice(-5))
    expect(nb).toBe(na + 1)
  })

  it('un usuario de tenant NO puede pedir numeros', async () => {
    await expect(asTenantUser((tx) => tx`select regb.next_invoice_number()`)).rejects.toThrow(
      /permission denied/,
    )
  })
})

describe('Una factura por tenant y periodo (regla 7)', () => {
  it('la segunda generacion del mismo periodo no crea nada', async () => {
    const first = await insertInvoice('2099-01-01')
    const second = await insertInvoice('2099-01-01')
    expect(first).toBeTruthy()
    expect(second).toBeNull()

    const [count] = await sql<{ c: string }[]>`
      select count(*) as c from regb.invoices
      where tenant_id = ${tenant} and period_start = '2099-01-01'`
    expect(Number(count!.c)).toBe(1)
  })

  it('anular la factura permite reemitir el periodo (nota de credito)', async () => {
    await sql`update regb.invoices set status = 'void'
      where tenant_id = ${tenant} and period_start = '2099-01-01'`
    const reissued = await insertInvoice('2099-01-01')
    expect(reissued).toBeTruthy()
  })
})

describe('record_payment — un webhook repetido no cobra dos veces (regla 7)', () => {
  it('el primer pago marca la factura como pagada', async () => {
    const id = await insertInvoice('2099-02-01')
    const [paid] = await sql<{ status: string; paid_at: string }[]>`
      select status, paid_at from regb.record_payment(${id}, ${`ext-${RUN}-1`}, 'stripe')`
    expect(paid!.status).toBe('paid')
    expect(paid!.paid_at).toBeTruthy()
  })

  it('el mismo external_id aplicado otra vez es un no-op', async () => {
    const [inv] = await sql<{ id: string; paid_at: string }[]>`
      select id, paid_at from regb.invoices
      where tenant_id = ${tenant} and period_start = '2099-02-01' and status = 'paid'`

    await sql`select regb.record_payment(${inv!.id}, ${`ext-${RUN}-1`}, 'stripe')`

    const [attempts] = await sql<{ c: string }[]>`
      select count(*) as c from regb.payment_attempts where invoice_id = ${inv!.id}`
    expect(Number(attempts!.c)).toBe(1)

    const [after] = await sql<{ paid_at: string }[]>`
      select paid_at from regb.invoices where id = ${inv!.id}`
    expect(after!.paid_at).toEqual(inv!.paid_at)
  })

  it('una factura ya pagada ignora cobros nuevos aunque cambie el external_id', async () => {
    const [inv] = await sql<{ id: string }[]>`
      select id from regb.invoices
      where tenant_id = ${tenant} and period_start = '2099-02-01' and status = 'paid'`

    await sql`select regb.record_payment(${inv!.id}, ${`ext-${RUN}-2`}, 'azul')`

    const [attempts] = await sql<{ c: string }[]>`
      select count(*) as c from regb.payment_attempts where invoice_id = ${inv!.id}`
    expect(Number(attempts!.c)).toBe(1)
  })
})

describe('Aislamiento', () => {
  it('un usuario de tenant no ve los intentos de cobro', async () => {
    await expect(asTenantUser((tx) => tx`select * from regb.payment_attempts`)).rejects.toThrow(
      /permission denied/,
    )
  })

  it('un usuario de tenant SI ve sus propias facturas (portal de suscripcion)', async () => {
    const rows = await asTenantUser(
      (tx) => tx<{ number: string }[]>`select number from regb.invoices`,
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})
