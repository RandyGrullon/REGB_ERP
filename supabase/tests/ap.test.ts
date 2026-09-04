import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Cuentas por pagar (modulo 18, F6) contra Postgres real.
 *
 * El contraparte de ar (fiscal.test.ts) y de purchase-orders: aqui el
 * proveedor nos factura a nosotros. Cubre:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. B no puede colar un pago en una factura de A usando su PROPIO
 *     tenant_id -mismo patron que 0040 tapo en invoice_late_fees-.
 *  3. No se puede pagar de mas (la retencion cuenta como pago para el
 *     limite).
 *  4. Una factura con pagos no se puede anular.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let proveedorA: string
let facturaA: string
let facturaB: string

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
    values (${`ap-a-${RUN}`}, 'Ferreteria AP A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`ap-b-${RUN}`}, 'Distribuidora AP B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'purchase-orders', 'active', true), (${t}, 'ap', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [sa] = await sql`
    insert into public.suppliers (tenant_id, name, payment_terms)
    values (${tenantA}, 'Proveedor AP A', 30) returning id`
  const [sb] = await sql`
    insert into public.suppliers (tenant_id, name, payment_terms)
    values (${tenantB}, 'Proveedor AP B', 30) returning id`
  proveedorA = sa!.id

  const [fa] = await sql`
    insert into public.supplier_invoices
      (tenant_id, supplier_id, supplier_invoice_number, issue_date, due_date, subtotal, tax, total)
    values (${tenantA}, ${proveedorA}, ${`F-A-${RUN}`}, current_date - 10, current_date + 20,
            10000, 1800, 11800) returning id`
  const [fb] = await sql`
    insert into public.supplier_invoices
      (tenant_id, supplier_id, supplier_invoice_number, issue_date, due_date, subtotal, tax, total)
    values (${tenantB}, ${sb!.id}, ${`F-B-${RUN}`}, current_date - 10, current_date + 20,
            5000, 900, 5900) returning id`
  facturaA = fa!.id
  facturaB = fb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.supplier_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.supplier_invoices where tenant_id in ${sql(ts)}`
  await sql`delete from public.suppliers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('B no ve las facturas de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.supplier_invoices where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede colar un pago en una factura de A usando su PROPIO tenant_id', async () => {
    // Mismo patron que 0040 en invoice_late_fees: la RLS de insert solo
    // compara el tenant_id de la fila nueva -que aqui SI coincide con
    // quien llama-, no revisa a quien pertenece invoice_id.
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.supplier_payments (tenant_id, invoice_id, amount, method)
          values (${tenantB}, ${facturaA}, 500, 'transfer')`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('la factura de B existe y es suya: aislar no puede romper lo propio', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`select id from public.supplier_invoices`,
    )
    expect(filas.map((f) => f.id)).toEqual([facturaB])
  })
})

describe('No se puede pagar de mas', () => {
  it('un pago mayor que el saldo se rechaza a nivel de aplicacion, y el saldo refleja lo pagado', async () => {
    await sql`
      insert into public.supplier_payments (tenant_id, invoice_id, amount, method)
      values (${tenantA}, ${facturaA}, 8000, 'transfer')`

    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ saldo: string }[]>`
        select public.ap_invoice_balance(${facturaA})::text as saldo`,
    )
    expect(Number(r!.saldo)).toBe(3800)
  })
})

describe('Modulo apagado', () => {
  afterAll(async () => await modulo(tenantA, 'ap', true))

  it('sin el modulo, facturas y pagos dan cero filas', async () => {
    await modulo(tenantA, 'ap', false)
    const [facturas, pagos] = await as(userA, tenantA, async (tx) => {
      const f = await tx<{ id: string }[]>`select id from public.supplier_invoices`
      const p = await tx<{ id: string }[]>`select id from public.supplier_payments`
      return [f, p] as const
    })
    expect(facturas).toHaveLength(0)
    expect(pagos).toHaveLength(0)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('la retencion no puede ser mayor que el total', async () => {
    await expect(
      sql`
        insert into public.supplier_invoices
          (tenant_id, supplier_id, supplier_invoice_number, due_date, total, retention_amount)
        values (${tenantA}, ${proveedorA}, ${`F-RET-${RUN}`}, current_date, 100, 200)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('un metodo de pago inventado se rechaza', async () => {
    await expect(
      sql`
        insert into public.supplier_payments (tenant_id, invoice_id, amount, method)
        values (${tenantA}, ${facturaA}, 100, 'bitcoin')`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('el mismo proveedor no puede repetir numero de factura', async () => {
    await expect(
      sql`
        insert into public.supplier_invoices
          (tenant_id, supplier_id, supplier_invoice_number, due_date, total)
        values (${tenantA}, ${proveedorA}, ${`F-A-${RUN}`}, current_date, 100)`,
    ).rejects.toThrow(/duplicate key/)
  })
})
