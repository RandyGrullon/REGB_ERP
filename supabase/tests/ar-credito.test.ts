import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

/**
 * Venta a credito de verdad (0130) contra Postgres real.
 *
 * Lo que la base garantiza por su cuenta, aunque alguien escriba por
 * PostgREST (el movil) o por una segunda pantalla mañana:
 *
 *  1. Aislamiento: excepciones, politica, lineas de factura y notas de
 *     credito de A no las ve ni las toca B. Con `ar` apagado, nadie.
 *  2. Una excepcion autorizada, una linea de factura y una nota de
 *     credito no se editan ni se borran desde una sesion.
 *  3. Un cobro no se edita: se reversa con motivo, una sola vez, y el
 *     saldo lo deja de contar.
 *  4. El saldo es capital + mora - cobros vigentes - notas.
 *  5. Las notas no pasan del total de la factura, ni devuelven mas de lo
 *     facturado por linea, ni van sobre una anulada.
 *  6. Las FK nuevas no apuntan a otro cliente (0121).
 *  7. El limite de credito lo fija quien tiene ar.credit.manage, tambien
 *     por PostgREST.
 *  8. El Contador de fabrica no autoriza excepciones, tampoco en un
 *     cliente nuevo.
 */

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'
const sql = postgres(URL, { max: 8, onnotice: () => {} })

const RUN = crypto.randomUUID().slice(0, 8)
const userA = crypto.randomUUID()
const userB = crypto.randomUUID()
let tenantA: string
let tenantB: string
let clienteA: string
let clienteB: string
let facturaA: string
let facturaB: string
let lineaA: string

const claims = (userId: string, tenantId: string, roleId?: string) =>
  JSON.stringify({
    sub: userId,
    app_metadata: { tenant_id: tenantId, is_provider: false, ...(roleId ? { role_id: roleId } : {}) },
  })

async function as<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
  roleId?: string,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(userId, tenantId, roleId)}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

async function modulo(tenant: string, id: string, encendido: boolean) {
  await sql`
    update regb.tenant_modules set enabled = ${encendido}
    where tenant_id = ${tenant} and module_id = ${id}`
}

async function saldo(invoiceId: string): Promise<number> {
  const [s] = await sql<{ s: string }[]>`select public.invoice_balance(${invoiceId})::text as s`
  return Number(s!.s)
}

beforeAll(async () => {
  const [a] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`credito-a-${RUN}`}, 'Tienda Credito A SRL', 'pyme', 'active') returning id`
  const [b] = await sql`
    insert into regb.tenants (slug, legal_name, tier, status)
    values (${`credito-b-${RUN}`}, 'Tienda Credito B SRL', 'pyme', 'active') returning id`
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
    values (${tenantA}, 'Cliente Credito A', 30) returning id`
  const [cb] = await sql`
    insert into public.customers (tenant_id, name, payment_terms)
    values (${tenantB}, 'Cliente Credito B', 30) returning id`
  clienteA = ca!.id
  clienteB = cb!.id

  const [fa] = await sql`
    insert into public.customer_invoices
      (tenant_id, number, customer_id, source_type, issue_date, due_date,
       subtotal, tax, total, status, ncf, ncf_type)
    values (${tenantA}, ${`FA-CRED-A-${RUN}`}, ${clienteA}, 'manual',
            current_date - 40, current_date - 10, 10000, 1800, 11800, 'overdue',
            ${`B01${RUN.replace(/\D/g, '1').padEnd(8, '1').slice(0, 8)}`}, 'B01')
    returning id`
  const [fb] = await sql`
    insert into public.customer_invoices
      (tenant_id, number, customer_id, source_type, issue_date, due_date, total, status)
    values (${tenantB}, ${`FA-CRED-B-${RUN}`}, ${clienteB}, 'manual',
            current_date - 40, current_date - 10, 5000, 'overdue') returning id`
  facturaA = fa!.id
  facturaB = fb!.id

  const [la] = await sql`
    insert into public.customer_invoice_lines
      (invoice_id, tenant_id, description, qty, unit_price, tax_rate, subtotal, tax, line_total)
    values (${facturaA}, ${tenantA}, 'Televisor 55"', 10, 1000, 0.18, 10000, 1800, 11800)
    returning id`
  lineaA = la!.id
})

afterAll(async () => {
  const ts = [tenantA, tenantB]
  await sql`delete from public.customer_credit_note_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_credit_notes where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_credit_note_counters where tenant_id in ${sql(ts)}`
  await sql`delete from public.credit_overrides where tenant_id in ${sql(ts)}`
  await sql`delete from public.ar_credit_policy where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_invoice_lines where tenant_id in ${sql(ts)}`
  await sql`delete from public.invoice_late_fees where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_payments where tenant_id in ${sql(ts)}`
  await sql`delete from public.customer_invoices where tenant_id in ${sql(ts)}`
  await sql`delete from public.customers where tenant_id in ${sql(ts)}`
  await sql`delete from public.event_outbox where tenant_id in ${sql(ts)}`
  await sql`delete from audit.log where tenant_id in ${sql(ts)}`
  await sql`delete from regb.tenants where id in ${sql(ts)}`
  await sql.end()
})

// ─────────────────────────────────────────────────────────────────────────
describe('Aislamiento y modulo apagado', () => {
  beforeAll(async () => {
    await sql`
      insert into public.credit_overrides
        (tenant_id, customer_id, stage, blocks, document_total, exposure, reason)
      values (${tenantA}, ${clienteA}, 'confirm', array['overdue'], 100, 11800, 'Autorizado A')`
    await sql`
      insert into public.ar_credit_policy (tenant_id, overdue_block_days) values (${tenantA}, 45)`
  })

  for (const tabla of [
    'credit_overrides',
    'ar_credit_policy',
    'customer_invoice_lines',
    'customer_credit_notes',
    'customer_credit_note_lines',
  ]) {
    it(`B no ve ${tabla} de A`, async () => {
      const filas = await as(userB, tenantB, (tx) =>
        tx.unsafe(`select 1 from public.${tabla} where tenant_id = $1`, [tenantA]),
      )
      expect(filas).toHaveLength(0)
    })
  }

  it('A ve lo suyo; con ar apagado, nada', async () => {
    const ver = () =>
      as(userA, tenantA, (tx) => tx`select 1 from public.credit_overrides where tenant_id = ${tenantA}`)
    expect((await ver()).length).toBeGreaterThan(0)
    await modulo(tenantA, 'ar', false)
    try {
      expect(await ver()).toHaveLength(0)
    } finally {
      await modulo(tenantA, 'ar', true)
    }
  })

  it('B no escribe una excepcion ni una politica con el tenant de A', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`
        insert into public.ar_credit_policy (tenant_id, overdue_block_days)
        values (${tenantA}, 365)`),
    ).rejects.toThrow()
  })

  it('una excepcion de B no puede apuntar al cliente de A (0121)', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`
        insert into public.credit_overrides
          (tenant_id, customer_id, stage, blocks, document_total, exposure, reason)
        values (${tenantB}, ${clienteA}, 'confirm', array['limit'], 1, 1, 'Colado')`),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('B no numera notas de credito de A', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`select public.next_credit_note_number(${tenantA})`),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Lo firmado no se edita ni se borra desde una sesion', () => {
  for (const tabla of [
    'credit_overrides',
    'customer_invoice_lines',
    'customer_credit_notes',
    'customer_credit_note_lines',
  ]) {
    it(`${tabla}: ni update ni delete para authenticated`, async () => {
      const [p] = await sql<{ upd: boolean; del: boolean; ins: boolean }[]>`
        select has_table_privilege('authenticated', ${`public.${tabla}`}, 'UPDATE') as upd,
               has_table_privilege('authenticated', ${`public.${tabla}`}, 'DELETE') as del,
               has_table_privilege('authenticated', ${`public.${tabla}`}, 'INSERT') as ins`
      expect(p).toEqual({ upd: false, del: false, ins: true })
    })
  }

  it('una excepcion no se puede reescribir', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.credit_overrides set reason = 'Otra cosa' where tenant_id = ${tenantA}`),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('una excepcion sin motivo, o con una regla inventada, no entra', async () => {
    await expect(sql`
      insert into public.credit_overrides
        (tenant_id, customer_id, stage, blocks, document_total, exposure, reason)
      values (${tenantA}, ${clienteA}, 'confirm', array['overdue'], 1, 1, '  ')`).rejects.toThrow()
    await expect(sql`
      insert into public.credit_overrides
        (tenant_id, customer_id, stage, blocks, document_total, exposure, reason)
      values (${tenantA}, ${clienteA}, 'confirm', array['porque si'], 1, 1, 'Motivo')`).rejects.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Cobros: se reversan, no se editan', () => {
  let pago: string

  beforeAll(async () => {
    const [p] = await sql`
      insert into public.customer_payments (tenant_id, invoice_id, amount, method)
      values (${tenantA}, ${facturaA}, 5000, 'cash') returning id`
    pago = p!.id
  })

  it('el monto de un cobro no se edita', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`update public.customer_payments set amount = 500 where id = ${pago}`),
    ).rejects.toThrow(/no se edita/)
  })

  it('reversar sin motivo no pasa', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.customer_payments set reversed_at = now(), reversal_reason = ''
        where id = ${pago}`),
    ).rejects.toThrow()
  })

  it('reversado con motivo deja de contar en el saldo; la fila queda', async () => {
    expect(await saldo(facturaA)).toBe(6800)
    await as(userA, tenantA, (tx) => tx`
      update public.customer_payments
      set reversed_at = now(), reversed_by = ${userA}, reversal_reason = 'Se digito 5000 y era 500'
      where id = ${pago}`)
    expect(await saldo(facturaA)).toBe(11800)
    const [f] = await sql<{ n: string }[]>`
      select count(*)::text as n from public.customer_payments where id = ${pago}`
    expect(f!.n).toBe('1')
  })

  it('un reverso no se deshace', async () => {
    await expect(
      as(userA, tenantA, (tx) => tx`
        update public.customer_payments set reversed_at = null, reversal_reason = null
        where id = ${pago}`),
    ).rejects.toThrow(/no se deshace/)
  })

  it('un cobro no se borra (0108 sigue en pie)', async () => {
    const [p] = await sql<{ del: boolean }[]>`
      select has_table_privilege('authenticated', 'public.customer_payments', 'DELETE') as del`
    expect(p!.del).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Saldo y notas de credito', () => {
  it('saldo = capital + mora - cobros vigentes - notas', async () => {
    await sql`
      insert into public.invoice_late_fees (tenant_id, invoice_id, amount, days_late_at_charge)
      values (${tenantA}, ${facturaA}, 500, 10)`
    await sql`
      insert into public.customer_payments (tenant_id, invoice_id, amount, method)
      values (${tenantA}, ${facturaA}, 1000, 'transfer')`
    const [n] = await sql`
      insert into public.customer_credit_notes
        (tenant_id, number, invoice_id, customer_id, kind, reason, subtotal, tax, total)
      values (${tenantA}, ${`NC-${RUN}-1`}, ${facturaA}, ${clienteA}, 'return',
              'Devolvio 2', 2000, 360, 2360) returning id`
    await sql`
      insert into public.customer_credit_note_lines
        (credit_note_id, tenant_id, invoice_line_id, description, qty, unit_price, tax_rate,
         subtotal, tax, line_total)
      values (${n!.id}, ${tenantA}, ${lineaA}, 'Televisor 55"', 2, 1000, 0.18, 2000, 360, 2360)`
    // 11,800 + 500 - 1,000 (el de 5,000 esta reversado) - 2,360
    expect(await saldo(facturaA)).toBe(8940)
  })

  it('no se devuelve mas de lo facturado en la linea', async () => {
    const [n] = await sql`
      insert into public.customer_credit_notes
        (tenant_id, number, invoice_id, customer_id, kind, reason, subtotal, tax, total)
      values (${tenantA}, ${`NC-${RUN}-2`}, ${facturaA}, ${clienteA}, 'return',
              'Devolvio 9 mas', 100, 0, 100) returning id`
    await expect(sql`
      insert into public.customer_credit_note_lines
        (credit_note_id, tenant_id, invoice_line_id, description, qty, unit_price, tax_rate,
         subtotal, tax, line_total)
      values (${n!.id}, ${tenantA}, ${lineaA}, 'Televisor 55"', 9, 1000, 0.18, 9000, 1620, 10620)`,
    ).rejects.toThrow(/facturo por 10/)
  })

  it('las notas no pasan del total de la factura', async () => {
    await expect(sql`
      insert into public.customer_credit_notes
        (tenant_id, number, invoice_id, customer_id, kind, reason, total)
      values (${tenantA}, ${`NC-${RUN}-3`}, ${facturaA}, ${clienteA}, 'adjustment',
              'Rebaja enorme', 99999)`).rejects.toThrow(/sumarian/)
  })

  it('la nota va al mismo cliente de la factura', async () => {
    const [otro] = await sql`
      insert into public.customers (tenant_id, name) values (${tenantA}, 'Otro Cliente A') returning id`
    await expect(sql`
      insert into public.customer_credit_notes
        (tenant_id, number, invoice_id, customer_id, kind, reason, total)
      values (${tenantA}, ${`NC-${RUN}-4`}, ${facturaA}, ${otro!.id}, 'adjustment', 'Rebaja', 1)`,
    ).rejects.toThrow(/mismo cliente/)
  })

  it('una nota de B sobre la factura de A se rechaza', async () => {
    await expect(
      as(userB, tenantB, (tx) => tx`
        insert into public.customer_credit_notes
          (tenant_id, number, invoice_id, customer_id, kind, reason, total)
        values (${tenantB}, ${`NC-${RUN}-B`}, ${facturaA}, ${clienteB}, 'adjustment', 'Colada', 1)`),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('sobre una factura anulada no hay nota', async () => {
    await sql`update public.customer_invoices set status = 'void', void_reason = 'Prueba'
              where id = ${facturaB}`
    await expect(sql`
      insert into public.customer_credit_notes
        (tenant_id, number, invoice_id, customer_id, kind, reason, total)
      values (${tenantB}, ${`NC-${RUN}-5`}, ${facturaB}, ${clienteB}, 'adjustment', 'Rebaja', 1)`,
    ).rejects.toThrow(/anulada/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('El limite de credito lo fija quien puede, tambien por PostgREST', () => {
  let rolVendedor: string
  let rolCartera: string

  beforeAll(async () => {
    const [v] = await sql`
      insert into public.roles (tenant_id, name, visible_modules, permissions)
      values (${tenantA}, ${`Vendedor ${RUN}`}, array['sales-orders'],
              ${JSON.stringify({ 'sales-orders.*': true })}::text::jsonb) returning id`
    const [c] = await sql`
      insert into public.roles (tenant_id, name, visible_modules, permissions)
      values (${tenantA}, ${`Cartera ${RUN}`}, array['ar'],
              ${JSON.stringify({ 'ar.*': true, 'sales-orders.*': true })}::text::jsonb) returning id`
    rolVendedor = v!.id
    rolCartera = c!.id
  })

  it('con un token de Vendedor, subirle el limite a su cliente se rechaza', async () => {
    await expect(
      as(
        userA,
        tenantA,
        (tx) => tx`update public.customers set credit_limit = 999999 where id = ${clienteA}`,
        rolVendedor,
      ),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('el vendedor si puede editar el telefono del mismo cliente', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx`update public.customers set phone = '809-555-0101' where id = ${clienteA} returning id`,
      rolVendedor,
    )
    expect(filas).toHaveLength(1)
  })

  it('con ar.credit.manage si', async () => {
    const filas = await as(
      userA,
      tenantA,
      (tx) => tx`update public.customers set credit_limit = 50000 where id = ${clienteA} returning id`,
      rolCartera,
    )
    expect(filas).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('Roles de fabrica', () => {
  it('el Contador de un cliente NUEVO no autoriza excepciones de credito', async () => {
    const [t] = await sql`
      insert into regb.tenants (slug, legal_name, tier, status)
      values (${`credito-n-${RUN}`}, 'Cliente Nuevo SRL', 'pyme', 'active') returning id`
    try {
      const [r] = await sql<{ p: Record<string, unknown> }[]>`
        select permissions as p from public.roles
        where tenant_id = ${t!.id} and is_system and name = 'Contador'`
      expect(r!.p['ar.credit.override']).toBe(false)
      // Y el resto de su cartera sigue igual.
      expect(r!.p['ar.*']).toBe(true)
    } finally {
      await sql`delete from audit.log where tenant_id = ${t!.id}`
      await sql`delete from regb.tenants where id = ${t!.id}`
    }
  })
})
