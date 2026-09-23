import 'server-only'

import { db } from './db'
import { loadTenantsWithModules, quoteTenant } from './control'
import { fromCents, roundBankers } from '@regb/core'
import { invoiceDueDate, isoDate, monthlyPeriod } from '@regb/billing'

/**
 * Generacion de facturas (S16).
 *
 * Reglas del agente regb-billing hechas codigo:
 *  3. Reproducible: `lines` guarda el desglose completo que produjo el
 *     motor. La factura se reconstruye anos despues aunque cambien precios.
 *  7. Idempotente: el indice unico (tenant, periodo) hace que generar dos
 *     veces el mismo mes NO cree dos facturas. Se comprueba antes de pedir
 *     numero para no quemar numeracion, y el indice respalda la carrera.
 *
 * Desde 0128 la factura es la formula completa -uso medido, ITBIS e
 * instalacion de lo recien activado- y es la MISMA cotizacion que REGB
 * Control ensena como "proxima factura" (`quoteTenant(...).invoice`).
 * Vence a los 15 dias (`invoiceDueDate`), no el primer dia del periodo.
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

/**
 * `slug` limita la corrida a un cliente: el panel factura a todos, y una
 * prueba -o una re-emision a mano- no tiene por que tocar a los demas.
 */
export async function generateMonthlyInvoices(
  anchor = new Date(),
  slug?: string,
): Promise<GenerationResult> {
  const sql = db()
  const { start, end } = monthlyPeriod(anchor)
  const periodStart = isoDate(start)
  const periodEnd = isoDate(end)

  const dueAt = isoDate(invoiceDueDate(start, new Date()))

  const { tenants, modulesByTenant, pendingInstallByTenant } = await loadTenantsWithModules(slug)
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

    const { invoice: cuenta, installationCharges } = quoteTenant(
      tenant,
      modulesByTenant.get(tenant.id) ?? [],
      pendingInstallByTenant.get(tenant.id) ?? [],
    )

    // Transaccion: numero + insert juntos. Si el insert choca con el indice
    // unico (carrera con otra generacion), el rollback devuelve el numero.
    // Las instalaciones se marcan DENTRO: si la factura no nace, siguen
    // pendientes para la siguiente; si nace, no se cobran dos veces.
    const invoice = await sql.begin(async (tx) => {
      const [numbered] = await tx<{ next_invoice_number: string }[]>`
        select regb.next_invoice_number()`
      if (!numbered) throw new Error('next_invoice_number no devolvio numero')
      const number = numbered.next_invoice_number

      const [row] = await tx<{ id: string; number: string }[]>`
        insert into regb.invoices
          (tenant_id, number, period_start, period_end,
           subtotal, discount, tax, total, currency, status, due_at, lines)
        values
          (${tenant.id}, ${number}, ${periodStart}, ${periodEnd},
           ${roundBankers(fromCents(cuenta.subtotalCents), 2)},
           ${roundBankers(fromCents(cuenta.discountCents), 2)},
           ${roundBankers(fromCents(cuenta.taxCents), 2)},
           ${cuenta.total}, 'USD', 'sent', ${dueAt},
           ${sql.json(cuenta.lines.map((l) => ({ label: l.label, detail: l.detail ?? null, amount: roundBankers(fromCents(l.amountCents), 2) })))})
        on conflict (tenant_id, period_start) where status <> 'void' do nothing
        returning id, number`
      if (!row) return null

      for (const cargo of installationCharges) {
        await tx`
          update regb.module_installation_charges
          set amount = ${roundBankers(fromCents(cargo.amountCents), 2)},
              invoice_id = ${row.id}, charged_at = now(),
              note = ${cargo.included ? 'Dentro de los modulos incluidos del tier' : null}
          where tenant_id = ${tenant.id} and module_id = ${cargo.moduleId} and amount is null`
      }
      return row
    })

    if (invoice) {
      created.push({ tenant: tenant.legal_name, number: invoice.number, total: cuenta.total })
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
