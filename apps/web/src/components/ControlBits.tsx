import { Badge } from '@regb/ui'
import { fromCents } from '@regb/core'
import type { TenantTier } from '@regb/core'
import type { InvoiceResult } from '@regb/billing'

/**
 * Piezas compartidas de REGB Control. Sin 'use client': todo esto se
 * renderiza en el servidor, que es donde viven las cifras (§7).
 */

export function usd(n: number): string {
  return `US$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const TIER_TONE = { pyme: 'success', mediano: 'info', grande: 'brand' } as const
const TIER_LABEL = { pyme: 'PYME', mediano: 'MEDIANO', grande: 'GRANDE' } as const

export function TierBadge({ tier }: { tier: TenantTier }) {
  return <Badge tone={TIER_TONE[tier]}>{TIER_LABEL[tier]}</Badge>
}

const STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  trial: 'info',
  past_due: 'warning',
  readonly: 'warning',
  suspended: 'danger',
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo',
  trial: 'En prueba',
  past_due: 'En mora',
  readonly: 'Solo lectura',
  suspended: 'Suspendido',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Badge>
}

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Mensual',
  annual: 'Anual',
  biennial: 'Bianual',
  triennial: 'Trianual',
}

export function cycleLabel(cycle: string): string {
  return CYCLE_LABEL[cycle] ?? cycle
}

/**
 * Desglose linea por linea de una factura del motor. Es la misma
 * estructura que se persiste en `invoices.lines`: lo que ves aqui es lo
 * que quedara en el registro contable.
 */
export function InvoiceBreakdown({ result }: { result: InvoiceResult }) {
  return (
    <div className="text-[13px]">
      <ul className="divide-y divide-[var(--color-border)]">
        {result.lines.map((line, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-2">
            <div className="min-w-0">
              <p className="text-[var(--color-text-primary)]">{line.label}</p>
              {line.detail && (
                <p className="text-xs text-[var(--color-text-muted)]">{line.detail}</p>
              )}
            </div>
            <span className="tabular shrink-0 text-[var(--color-text-secondary)]">
              {usd(fromCents(line.amountCents))}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t-2 border-[var(--color-border)] pt-3">
        <span className="font-semibold text-[var(--color-text-primary)]">Total</span>
        <span className="tabular text-lg font-bold text-[var(--color-text-primary)]">
          {usd(result.total)}
        </span>
      </div>
    </div>
  )
}
