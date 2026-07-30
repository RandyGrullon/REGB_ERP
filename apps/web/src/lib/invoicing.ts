import 'server-only'

import { db } from './db'
import { loadTenantsWithModules, quoteTenant } from './control'
import { fromCents, roundBankers } from '@regb/core'
import { isoDate, monthlyPeriod } from '@regb/billing'

/**
 * Generacion de facturas (S16).
 *
 * Reglas del agente regb-billing hechas codigo:
 *  3. Reproducible: `lines` guarda el desglose completo que produjo el
 *     motor. La factura se reconstruye anos despues aunque cambien precios.
 *  7. Idempotente: el indice unico (tenant, periodo) hace que generar dos
 *     veces el mismo mes NO cree dos facturas. Se comprueba antes de pedir
 *     numero para no quemar numeracion, y el indice respalda la carrera.
 */

export interface InvoiceRow {
  id: string
  number: string
  tenantSlug: string
  tenantName: string
  periodStart: string
  periodEnd: string
  subtotal: number
  discount: number
  tax: number
  total: number
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void'
  dueAt: string
  paidAt: string | null
}

export interface GenerationResult {
  created: { tenant: string; number: string; total: number }[]
  skipped: { tenant: string; reason: string }[]
}

/** Estados que facturan. `trial` no paga y `suspended/archived` no consume. */
const BILLABLE_STATUSES = new Set(['active', 'past_due', 'readonly'])

export async function generateMonthlyInvoices(anchor = new Date()): Promise<GenerationResult> {
  const sql = db()
  const { start, end } = monthlyPeriod(anchor)
  const periodStart = isoDate(start)
  const periodEnd = isoDate(end)

  const { tenants, modulesByTenant } = await loadTenantsWithModules()
  const created: GenerationResult['created'] = []
  const skipped: GenerationResult['skipped'] = []

  for (const tenant of tenants) {
    if (!BILLABLE_STATUSES.has(tenant.status)) {
      skipped.push({ tenant: tenant.legal_name, reason: `estado ${tenant.status}: no factura` })
      continue
    }

    const [existing] = await sql<{ number: string }[]>`
      select number from regb.invoices
      where tenant_id = ${tenant.id} and period_start = ${periodStart} and status <> 'void'`
    if (existing) {
      skipped.push({ tenant: tenant.legal_name, reason: `ya existe ${existing.number}` })
      continue
    }

    const { monthly } = quoteTenant(tenant, modulesByTenant.get(tenant.id) ?? [])

    // Transaccion: numero + insert juntos. Si el insert choca con el indice
    // unico (carrera con otra generacion), el rollback devuelve el numero.
    const invoice = await sql.begin(async (tx) => {
      const [numbered] = await tx<{ next_invoice_number: string }[]>`
        select regb.next_invoice_number()`
      if (!numbered) throw new Error('next_invoice_number no devolvio numero')
      const number = numbered.next_invoice_number

      const [row] = await tx<{ number: string }[]>`
        insert into regb.invoices
          (tenant_id, number, period_start, period_end,
           subtotal, discount, tax, total, currency, status, due_at, lines)
        values
          (${tenant.id}, ${number}, ${periodStart}, ${periodEnd},
           ${roundBankers(fromCents(monthly.subtotalCents), 2)},
           ${roundBankers(fromCents(monthly.discountCents), 2)},
           ${roundBankers(fromCents(monthly.taxCents), 2)},
           ${monthly.total}, 'USD', 'sent', ${periodStart},
           ${sql.json(monthly.lines.map((l) => ({ label: l.label, detail: l.detail ?? null, amount: roundBankers(fromCents(l.amountCents), 2) })))})
        on conflict (tenant_id, period_start) where status <> 'void' do nothing
        returning number`
      return row ?? null
    })

    if (invoice) {
      created.push({ tenant: tenant.legal_name, number: invoice.number, total: monthly.total })
    } else {
      skipped.push({
        tenant: tenant.legal_name,
        reason: 'carrera: otra generacion la creo primero',
      })
    }
  }

  return { created, skipped }
}

export async function listInvoices(): Promise<InvoiceRow[]> {
  const rows = await db()<
    {
      id: string
      number: string
      slug: string
      legal_name: string
      period_start: string
      period_end: string
      subtotal: string
      discount: string
      tax: string
      total: string
      status: InvoiceRow['status']
      due_at: string
      paid_at: string | null
    }[]
  >`
    select i.id, i.number, t.slug, t.legal_name,
           i.period_start::text, i.period_end::text,
           i.subtotal::text, i.discount::text, i.tax::text, i.total::text,
           i.status, i.due_at::text, i.paid_at::text
    from regb.invoices i
    join regb.tenants t on t.id = i.tenant_id
    order by i.period_start desc, i.number desc`

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    tenantSlug: r.slug,
    tenantName: r.legal_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    subtotal: Number(r.subtotal),
    discount: Number(r.discount),
    tax: Number(r.tax),
    total: Number(r.total),
    status: r.status,
    dueAt: r.due_at,
    paidAt: r.paid_at,
  }))
}

/**
 * Registra un pago manual. `external_id` determinista por factura: marcar
 * pagada dos veces la misma factura es un no-op, no un doble cobro
 * (regb.record_payment deduplica por external_id).
 */
export async function recordManualPayment(invoiceId: string): Promise<void> {
  await db()`select regb.record_payment(${invoiceId}, ${`manual-${invoiceId}`}, 'manual')`
}
