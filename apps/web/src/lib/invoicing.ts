import 'server-only'

import { db } from './db'
import { loadTenantsWithModules, quoteTenant } from './control'
import { fromCents, roundBankers, type Cents } from '@regb/core'
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
  /** El desglose que se guardo al emitirla: lo que el cliente paga, linea por linea. */
  lines: { label: string; detail: string | null; amount: number }[]
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
      skipped.push({
        tenant: tenant.legal_name,
        reason: ESTADO_NO_FACTURA[tenant.status] ?? `estado ${tenant.status}: no factura`,
      })
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

/**
 * Lo que se le dice al proveedor despues de la corrida. Antes el aviso
 * comprobaba `typeof n === 'number'` sobre un objeto y siempre salia el
 * generico "generamos las facturas del mes", aunque no se hubiera emitido
 * ninguna.
 */
export function resumenDeCorrida(r: {
  created: { tenant: string }[]
  skipped: { tenant: string; reason: string }[]
}): string {
  const n = r.created.length
  const emitidas =
    n === 0
      ? 'No emitimos ninguna factura nueva'
      : `Listo, emitimos ${n} factura${n === 1 ? '' : 's'}`
  const ya = r.skipped.filter((s) => s.reason.startsWith('ya ')).length
  const otras = r.skipped.length - ya
  const partes = [
    ya > 0
      ? `${ya} cliente${ya === 1 ? '' : 's'} ya tenía${ya === 1 ? '' : 'n'} la de este mes`
      : '',
    otras > 0 ? `${otras} no factura${otras === 1 ? '' : 'n'} por su estado` : '',
  ].filter(Boolean)
  return partes.length > 0 ? `${emitidas}: ${partes.join(' y ')}.` : `${emitidas}.`
}

/** `slug` limita a un cliente: la ficha ensena solo las suyas. */
export async function listInvoices(slug?: string): Promise<InvoiceRow[]> {
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
      lines: { label: string; detail: string | null; amount: number | string }[] | null
    }[]
  >`
    select i.id, i.number, t.slug, t.legal_name,
           i.period_start::text, i.period_end::text,
           i.subtotal::text, i.discount::text, i.tax::text, i.total::text,
           i.status, i.due_at::text, i.paid_at::text, i.lines
    from regb.invoices i
    join regb.tenants t on t.id = i.tenant_id
    where (${slug ?? null}::text is null or t.slug = ${slug ?? null})
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
    lines: (Array.isArray(r.lines) ? r.lines : []).map((l) => ({
      label: String(l.label),
      detail: l.detail ?? null,
      amount: Number(l.amount),
    })),
  }))
}

// ── Vista previa de la corrida ───────────────────────────────────────────

export interface PreviewRow {
  tenant: string
  slug: string
  /** Lo que se va a emitir, o por que no. */
  total: number | null
  tax: number
  /** Parte del total que es instalacion (una sola vez), sin impuesto. */
  installation: number
  skip: string | null
}

/**
 * Lo que emitiria `generateMonthlyInvoices()` ahora mismo, sin emitir nada.
 *
 * "Generar facturas del mes" emite a todos los clientes de un clic; con
 * esto el proveedor ve cliente por cliente cuanto va a cobrar ANTES de
 * pulsar. Es la misma cotizacion (`quoteTenant`), asi que lo que dice la
 * vista previa es lo que sale.
 */
export async function previewMonthlyInvoices(anchor = new Date()): Promise<{
  period: string
  rows: PreviewRow[]
}> {
  const sql = db()
  const { start } = monthlyPeriod(anchor)
  const periodStart = isoDate(start)
  const { tenants, modulesByTenant, pendingInstallByTenant } = await loadTenantsWithModules()

  const existentes = new Map(
    (
      await sql<{ tenant_id: string; number: string }[]>`
        select tenant_id, number from regb.invoices
        where period_start = ${periodStart} and status <> 'void'`
    ).map((r) => [r.tenant_id, r.number]),
  )

  const rows: PreviewRow[] = tenants.map((t) => {
    const base = { tenant: t.legal_name, slug: t.slug }
    if (!BILLABLE_STATUSES.has(t.status)) {
      return {
        ...base,
        total: null,
        tax: 0,
        installation: 0,
        skip: ESTADO_NO_FACTURA[t.status] ?? 'no factura',
      }
    }
    const ya = existentes.get(t.id)
    if (ya) return { ...base, total: null, tax: 0, installation: 0, skip: `ya tiene la ${ya}` }
    const { invoice, installationCharges } = quoteTenant(
      t,
      modulesByTenant.get(t.id) ?? [],
      pendingInstallByTenant.get(t.id) ?? [],
    )
    return {
      ...base,
      total: invoice.total,
      tax: roundBankers(fromCents(invoice.taxCents), 2),
      installation: roundBankers(
        fromCents(installationCharges.reduce((a, c) => a + c.amountCents, 0) as Cents),
        2,
      ),
      skip: null,
    }
  })
  return { period: periodStart, rows }
}

const ESTADO_NO_FACTURA: Record<string, string> = {
  trial: 'en prueba: no factura',
  suspended: 'suspendido: no factura',
}

/**
 * Registra un pago manual. `external_id` determinista por factura: marcar
 * pagada dos veces la misma factura es un no-op, no un doble cobro
 * (regb.record_payment deduplica por external_id).
 */
export async function recordManualPayment(invoiceId: string): Promise<void> {
  await db()`select regb.record_payment(${invoiceId}, ${`manual-${invoiceId}`}, 'manual')`
}
