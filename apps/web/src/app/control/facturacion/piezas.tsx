import { usd } from '@/components/ControlBits'

/**
 * Piezas de las facturas de REGB que comparten Facturacion y la ficha del
 * cliente. Sin 'use client': el desglose es un <details> nativo.
 */

export const ESTADO_FACTURA: Record<
  string,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }
> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  sent: { label: 'Emitida', tone: 'info' },
  paid: { label: 'Pagada', tone: 'success' },
  overdue: { label: 'Vencida', tone: 'danger' },
  void: { label: 'Anulada', tone: 'neutral' },
}

/** "2026-09-01" -> "septiembre 2026": el periodo es un mes, no un dia. */
export function mesDe(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Lo que la factura cobra, linea por linea, tal como se guardo al emitirla.
 * Antes el panel decia que el desglose "queda en invoices.lines" y no habia
 * forma de verlo sin SQL.
 */
export function DesgloseFactura({
  lineas,
  total,
}: {
  lineas: { label: string; detail: string | null; amount: number }[]
  total: number
}) {
  if (lineas.length === 0) return null
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
        Ver desglose
      </summary>
      <ul className="mt-1 max-w-md divide-y divide-[var(--color-border)] text-xs">
        {lineas.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 py-1">
            <span className="min-w-0">
              <span className="text-[var(--color-text-primary)]">{l.label}</span>
              {l.detail && <span className="block text-[var(--color-text-muted)]">{l.detail}</span>}
            </span>
            <span className="tabular shrink-0 text-[var(--color-text-secondary)]">
              {usd(l.amount)}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 py-1 font-semibold text-[var(--color-text-primary)]">
          <span>Total</span>
          <span className="tabular">{usd(total)}</span>
        </li>
      </ul>
    </details>
  )
}
