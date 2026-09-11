import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Reporte 606 (compras) contra Postgres real.
 *
 * Lo primero que se prueba aqui NO es el formato: es que la vista no
 * filtre compras entre clientes. `dgii_607` y `dgii_608` se crearon sin
 * `security_invoker` y leian saltandose RLS -la fuga fiscal que tapo la
 * 0030-. Esta vista nace con la opcion puesta, y esta prueba existe para
 * que nadie la quite sin enterarse.
 *
 * Despues: la derivacion de la forma de pago, el desglose de retencion y
 * las guardas que impiden que el archivo salga con numeros negativos.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let provA: string
let provB: string

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

async function factura(
  tenant: string,
  proveedor: string,
  numero: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const base = {
    tenant_id: tenant,
    supplier_id: proveedor,
    supplier_invoice_number: numero,
    supplier_ncf: `B01${numero.padStart(8, '0')}`,
    issue_date: '2026-08-03',
    due_date: '2026-09-03',
    subtotal: 1000,
    tax: 180,
    total: 1180,
    ...extra,
  }
  const [f] = await sql`insert into public.supplier_invoices ${sql(base)} returning id`
  return f!.id as string
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`c606-a-${RUN}`}, 'Compras A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`c606-b-${RUN}`}, 'Compras B SRL', 'pyme', 'active') returning id`
  tenantA = a!.id
  tenantB = b!.id

  for (const t of [tenantA, tenantB]) {
    await sql`
      insert into regb.tenant_modules (tenant_id, module_id, status, enabled)
      values (${t}, 'ap', 'active', true), (${t}, 'purchase-orders', 'active', true)
      on conflict (tenant_id, module_id) do update set enabled = true, status = 'active'`
  }

  const [pa] = await sql`
    insert into public.suppliers (tenant_id, name, tax_id) values (${tenantA}, 'Distribuidora Nacional SRL', '131-22334-5') returning id`
  const [pb] = await sql`
    insert into public.suppliers (tenant_id, name, tax_id) values (${tenantB}, 'Suplidora del Este SRL', '130-99887-6') returning id`
  provA = pa!.id
  provB = pb!.id
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

describe('La fuga fiscal de la 0030 no se repite', () => {
  beforeAll(async () => {
    await factura(tenantA, provA, '1001', { expense_type: '09' })
    await factura(tenantB, provB, '2001', { expense_type: '09' })
  })

  it('la vista esta marcada security_invoker', async () => {
    const [v] = await sql<{ reloptions: string[] | null }[]>`
      select reloptions from pg_class where relname = 'dgii_606'`
    expect(v!.reloptions ?? []).toContain('security_invoker=true')
  })

  it('A solo ve sus propias compras', async () => {
    const filas = await as(userA, tenantA, (tx) => tx<{ ncf: string }[]>`select ncf from public.dgii_606`)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.ncf).toBe('B0100001001')
  })

  it('B no ve las compras de A ni apuntando a su tenant_id', async () => {
    const filas = await as(
      userB,
      tenantB,
      (tx) => tx<{ ncf: string }[]>`select ncf from public.dgii_606 where tenant_id = ${tenantA}`,
    )
    expect(filas).toHaveLength(0)
  })

  it('sin el modulo ap, la vista da cero filas', async () => {
    await sql`update regb.tenant_modules set enabled = false where tenant_id = ${tenantB} and module_id = 'ap'`
    const filas = await as(userB, tenantB, (tx) => tx<{ ncf: string }[]>`select ncf from public.dgii_606`)
    expect(filas).toHaveLength(0)
    await sql`update regb.tenant_modules set enabled = true where tenant_id = ${tenantB} and module_id = 'ap'`
  })
})

describe('La forma de pago se deriva de los pagos reales', () => {
  it('sin pagos es compra a credito (04)', async () => {
    await factura(tenantA, provA, '1100', { expense_type: '09' })
    const [f] = await sql<{ forma_pago: string }[]>`
      select forma_pago from public.dgii_606 where ncf = 'B0100001100'`
    expect(f!.forma_pago).toBe('04')
  })

  it('pagada solo en efectivo es 01', async () => {
    const id = await factura(tenantA, provA, '1101', { expense_type: '09' })
    await sql`insert into public.supplier_payments (tenant_id, invoice_id, amount, method)
              values (${tenantA}, ${id}, 1180, 'cash')`
    const [f] = await sql<{ forma_pago: string }[]>`
      select forma_pago from public.dgii_606 where ncf = 'B0100001101'`
    expect(f!.forma_pago).toBe('01')
  })

  it('cheque y transferencia caen en el mismo codigo 02', async () => {
    const id = await factura(tenantA, provA, '1102', { expense_type: '09' })
    await sql`insert into public.supplier_payments (tenant_id, invoice_id, amount, method)
              values (${tenantA}, ${id}, 1180, 'check')`
    const [f] = await sql<{ forma_pago: string }[]>`
      select forma_pago from public.dgii_606 where ncf = 'B0100001102'`
    expect(f!.forma_pago).toBe('02')
  })

  it('dos metodos distintos es mixto (07)', async () => {
    const id = await factura(tenantA, provA, '1103', { expense_type: '09' })
    await sql`insert into public.supplier_payments (tenant_id, invoice_id, amount, method)
              values (${tenantA}, ${id}, 600, 'cash'), (${tenantA}, ${id}, 580, 'transfer')`
    const [f] = await sql<{ forma_pago: string }[]>`
      select forma_pago from public.dgii_606 where ncf = 'B0100001103'`
    expect(f!.forma_pago).toBe('07')
  })

  it('la fecha de pago es la del ULTIMO pago, no la del primero', async () => {
    const id = await factura(tenantA, provA, '1104', { expense_type: '09' })
    await sql`insert into public.supplier_payments (tenant_id, invoice_id, amount, method, paid_at)
              values (${tenantA}, ${id}, 600, 'cash', '2026-08-10'),
                     (${tenantA}, ${id}, 580, 'cash', '2026-08-20')`
    const [f] = await sql<{ fecha_pago: string }[]>`
      select fecha_pago from public.dgii_606 where ncf = 'B0100001104'`
    expect(f!.fecha_pago).toBe('20260820')
  })
})

describe('El desglose de la retencion', () => {
  it('lo retenido que no es ISR se declara como ITBIS retenido', async () => {
    await factura(tenantA, provA, '1200', {
      expense_type: '02',
      retention_amount: 150,
      isr_retained: 100,
      isr_retention_type: '02',
    })
    const [f] = await sql<{ itbis_retenido: string; retencion_renta: string }[]>`
      select itbis_retenido::text, retencion_renta::text from public.dgii_606 where ncf = 'B0100001200'`
    expect(Number(f!.itbis_retenido)).toBe(50)
    expect(Number(f!.retencion_renta)).toBe(100)
  })

  it('retener por ISR mas de lo retenido en total se rechaza', async () => {
    await expect(
      factura(tenantA, provA, '1201', { retention_amount: 50, isr_retained: 100 }),
    ).rejects.toThrow(/isr_dentro_de_retencion/)
  })
})

describe('Lo que la tabla no deja pasar', () => {
  it('una clasificacion de gasto fuera del 01-11 se rechaza', async () => {
    await expect(factura(tenantA, provA, '1300', { expense_type: '12' })).rejects.toThrow(
      /violates check constraint/,
    )
  })

  it('mas servicios que subtotal se rechaza -bienes saldria negativo-', async () => {
    await expect(
      factura(tenantA, provA, '1301', { subtotal: 1000, services_amount: 1500 }),
    ).rejects.toThrow(/servicios_dentro_del_subtotal/)
  })

  it('una factura sin clasificar aparece en la vista con tipo_gasto nulo', async () => {
    await factura(tenantA, provA, '1400')
    const [f] = await sql<{ tipo_gasto: string | null }[]>`
      select tipo_gasto from public.dgii_606 where ncf = 'B0100001400'`
    expect(f!.tipo_gasto).toBeNull()
  })
})

describe('Que entra y que no entra al reporte', () => {
  it('una factura anulada no se declara', async () => {
    await factura(tenantA, provA, '1500', {
      expense_type: '09',
      status: 'void',
      void_reason: 'Duplicada',
    })
    const filas = await sql<{ ncf: string }[]>`select ncf from public.dgii_606 where ncf = 'B0100001500'`
    expect(filas).toHaveLength(0)
  })

  it('una compra sin NCF del proveedor no se declara', async () => {
    await factura(tenantA, provA, '1501', { expense_type: '09', supplier_ncf: null })
    const [f] = await sql<{ n: string }[]>`
      select count(*)::text as n from public.dgii_606
      where tenant_id = ${tenantA} and ncf is null`
    expect(f!.n).toBe('0')
  })

  it('el tipo de identificacion sale del largo del RNC', async () => {
    const [f] = await sql<{ tipo_identificacion: string; rnc_proveedor: string }[]>`
      select tipo_identificacion, rnc_proveedor from public.dgii_606 where ncf = 'B0100001001'`
    expect(f!.rnc_proveedor).toBe('131223345')
    expect(f!.tipo_identificacion).toBe('1')
  })
})
