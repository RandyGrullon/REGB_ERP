import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Cargo por mora (0040) contra Postgres real.
 *
 * No hay formula: el monto lo decide el negocio caso por caso. Lo que si
 * es innegociable y necesita prueba:
 *
 *  1. Aislamiento normal entre clientes.
 *  2. Un cliente exento no puede recibir un cargo NI POR UN DESCUIDO DEL
 *     SERVIDOR — la regla vive tambien en un trigger, no solo en la accion.
 *  3. El truco de la 0031: `invoice_id` puede pertenecer a CUALQUIER
 *     factura visible por id (RLS de insert solo mira `tenant_id` de la fila
 *     nueva, no a quien pertenece esa factura), asi que hace falta que el
 *     trigger compruebe que la factura es de ese mismo tenant.
 *  4. `invoice_balance()` refleja total + mora - cobrado.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let clienteA: string
let clienteExentoA: string
let clienteB: string
let facturaA: string
let facturaExentaA: string
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
    values (${`mora-a-${RUN}`}, 'Ferreteria Mora SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`mora-b-${RUN}`}, 'Distribuidora Mora SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'products', 'active', true), (${t}, 'sales-orders', 'active', true),
             (${t}, 'ar', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [ca] = await sql`
    insert into public.customers (tenant_id, name, payment_terms)
    values (${tenantA}, 'Constructora Mora A', 15) returning id`
  const [cea] = await sql`
    insert into public.customers (tenant_id, name, payment_terms, late_fee_exempt)
    values (${tenantA}, 'Cliente Exento A', 15, true) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms)
    values (${tenantB}, 'Constructora Mora B', 15) returning id`
  clienteA = ca!.id
  clienteExentoA = cea!.id
  clienteB = cb!.id

  // Vencidas hace 10 dias: con dias de atraso de verdad, no un caso limite.
  const [fa] = await sql`
    insert into public.customer_invoices
      (tenant_id, number, customer_id, source_type, issue_date, due_date, total, status)
    values (${tenantA}, ${`FA-MORA-A-${RUN}`}, ${clienteA}, 'manual',
            current_date - 25, current_date - 10, 10000, 'overdue') returning id`
  const [fea] = await sql`
    insert into public.customer_invoices
      (tenant_id, number, customer_id, source_type, issue_date, due_date, total, status)
    values (${tenantA}, ${`FA-MORA-EXA-${RUN}`}, ${clienteExentoA}, 'manual',
            current_date - 25, current_date - 10, 5000, 'overdue') returning id`
  const [fb] = await sql`
    insert into public.customer_invoices
      (tenant_id, number, customer_id, source_type, issue_date, due_date, total, status)
    values (${tenantB}, ${`FA-MORA-B-${RUN}`}, ${clienteB}, 'manual',
            current_date - 25, current_date - 10, 8000, 'overdue') returning id`
  facturaA = fa!.id
  facturaExentaA = fea!.id
  facturaB = fb!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.invoice_late_fees where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_invoices where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

describe('Aislamiento entre clientes', () => {
  it('B no ve los cargos por mora de A', async () => {
    await sql`
      insert into public.invoice_late_fees
        (tenant_id, invoice_id, amount, days_late_at_charge)
      values (${tenantA}, ${facturaA}, 300, 10)`

    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ id: string }[]>`
        select id from public.invoice_late_fees where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('B no puede aplicar un cargo directamente a una factura de A', async () => {
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.invoice_late_fees
            (tenant_id, invoice_id, amount, days_late_at_charge)
          values (${tenantA}, ${facturaA}, 500, 10)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('A no puede colar un cargo a la factura de B usando su PROPIO tenant_id', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.invoice_late_fees
            (tenant_id, invoice_id, amount, days_late_at_charge)
          values (${tenantA}, ${facturaB}, 500, 10)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })

  it('B no puede colar un cargo a la factura de A usando su PROPIO tenant_id', async () => {
    // El truco: la RLS de insert solo compara tenant_id de la fila nueva
    // contra auth.tenant_id() -no revisa a quien pertenece invoice_id-, asi
    // que sin el trigger esto pasaria la RLS y le colaria un cargo a un
    // cliente ajeno. Es el mismo agujero que la 0031 tapo en otro lado.
    await expect(
      as(
        userB,
        tenantB,
        (tx) => tx`
          insert into public.invoice_late_fees
            (tenant_id, invoice_id, amount, days_late_at_charge)
          values (${tenantB}, ${facturaA}, 500, 10)`,
      ),
    ).rejects.toThrow(/no pertenece a ese cliente/)
  })
})

describe('Cliente exento', () => {
  it('no se le puede aplicar un cargo por mora, ni con dias de atraso reales', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.invoice_late_fees
            (tenant_id, invoice_id, amount, days_late_at_charge)
          values (${tenantA}, ${facturaExentaA}, 200, 10)`,
      ),
    ).rejects.toThrow(/exento de cargos por mora/)
  })
})

describe('El saldo incluye la mora', () => {
  it('total + mora - cobrado', async () => {
    await sql`
      insert into public.customer_payments (tenant_id, invoice_id, amount, method)
      values (${tenantA}, ${facturaA}, 4000, 'cash')`

    const [r] = await as(
      userA,
      tenantA,
      (tx) => tx<{ saldo: string }[]>`
        select public.invoice_balance(${facturaA})::text as saldo`,
    )
    // 10000 total + 300 de mora (del test de aislamiento) - 4000 cobrado.
    expect(Number(r!.saldo)).toBe(6300)
  })
})

describe('Modulo ar apagado', () => {
  afterAll(async () => await modulo(tenantA, 'ar', true))

  it('sin el modulo, los cargos por mora dan cero filas', async () => {
    await modulo(tenantA, 'ar', false)
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx<{ id: string }[]>`select id from public.invoice_late_fees`,
    )
    expect(filas).toHaveLength(0)
  })

  it('sin el modulo no se puede aplicar un cargo', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`
          insert into public.invoice_late_fees
            (tenant_id, invoice_id, amount, days_late_at_charge)
          values (${tenantA}, ${facturaA}, 100, 5)`,
      ),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('un monto cero o negativo se rechaza', async () => {
    await expect(
      sql`
        insert into public.invoice_late_fees
          (tenant_id, invoice_id, amount, days_late_at_charge)
        values (${tenantA}, ${facturaA}, 0, 5)`,
    ).rejects.toThrow(/violates check constraint/)
  })

  it('dias de atraso negativos no tienen sentido', async () => {
    await expect(
      sql`
        insert into public.invoice_late_fees
          (tenant_id, invoice_id, amount, days_late_at_charge)
        values (${tenantA}, ${facturaA}, 100, -1)`,
    ).rejects.toThrow(/violates check constraint/)
  })
})
