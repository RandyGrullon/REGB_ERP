import Link from 'next/link'
import { Badge, StatCard, Table, THead, TBody, TR, TH, TD, EmptyState, Mono } from '@regb/ui'
import { listInvoices } from '@/lib/invoicing'
import { requireProvider } from '@/lib/provider-guard'
import { usd } from '@/components/ControlBits'
import { aplicarDunning, generarFacturasDelMes, registrarPago } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Facturacion · REGB Control' }

const STATUS: Record<
  string,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }
> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  sent: { label: 'Emitida', tone: 'info' },
  paid: { label: 'Pagada', tone: 'success' },
  overdue: { label: 'Vencida', tone: 'danger' },
  void: { label: 'Anulada', tone: 'neutral' },
}

const fecha = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/**
 * Facturacion (S16): emision idempotente y cobro manual.
 *
 * "Generar facturas del mes" se puede pulsar mil veces: el indice unico
 * (tenant, periodo) garantiza una factura por cliente por mes. "Registrar
 * pago" pasa por regb.record_payment, que deduplica por external_id.
 */
export default async function FacturacionPage() {
  await requireProvider()
  const invoices = await listInvoices()

  const cobrado = invoices.filter((i) => i.status === 'paid').reduce((a, i) => a + i.total, 0)
  const pendiente = invoices
    .filter((i) => i.status === 'sent' || i.status === 'overdue')
    .reduce((a, i) => a + i.total, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
          <Link href="/control" className="text-[var(--color-text-link)] hover:underline">
            Clientes
          </Link>{' '}
          › Facturacion
        </nav>
        <div className="ml-auto flex gap-2">
          <form action={aplicarDunning}>
            <button
              type="submit"
              title="Marca vencidas, degrada morosos (5/10/15/30/90) y recupera a quien pago. Idempotente; jamas borra."
              className="flex h-11 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 text-sm font-medium text-[var(--color-text-primary)] transition-colors duration-100 hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              Aplicar dunning
            </button>
          </form>
          <form action={generarFacturasDelMes}>
            <button
              type="submit"
              className="flex h-11 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors duration-100 hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              Generar facturas del mes
            </button>
          </form>
        </div>
      </div>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Facturas" value={String(invoices.length)} hint="emitidas en total" />
        <StatCard label="Cobrado" value={usd(cobrado)} hint="pagadas" />
        <StatCard label="Por cobrar" value={usd(pendiente)} hint="emitidas y vencidas" />
      </section>

      {invoices.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="Todavia no hay facturas"
          description={
            'Pulsa "Generar facturas del mes": una por cliente activo, calculada por el motor de precios. Generar dos veces no duplica nada.'
          }
        />
      ) : (
        <section aria-label="Facturas">
          <Table>
            <THead>
              <TR>
                <TH>Numero</TH>
                <TH>Cliente</TH>
                <TH>Periodo</TH>
                <TH>Estado</TH>
                <TH>Vence</TH>
                <TH numeric>Total</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((inv) => {
                const st = STATUS[inv.status] ?? { label: inv.status, tone: 'neutral' as const }
                return (
                  <TR key={inv.id}>
                    <TD>
                      <Mono>{inv.number}</Mono>
                    </TD>
                    <TD>
                      <Link
                        href={`/control/${inv.tenantSlug}`}
                        className="text-[var(--color-text-link)] hover:underline"
                      >
                        {inv.tenantName}
                      </Link>
                    </TD>
                    <TD>{fecha(inv.periodStart)}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD>{fecha(inv.dueAt)}</TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{usd(inv.total)}</span>
                    </TD>
                    <TD>
                      {(inv.status === 'sent' || inv.status === 'overdue') && (
                        <form action={registrarPago}>
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <button
                            type="submit"
                            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                          >
                            Registrar pago
                          </button>
                        </form>
                      )}
                      {inv.status === 'paid' && inv.paidAt && (
                        <span className="text-xs text-[var(--color-text-muted)]">
                          pagada {fecha(inv.paidAt)}
                        </span>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            El desglose completo de cada factura queda en <Mono>invoices.lines</Mono>: se puede
            reconstruir dentro de anos aunque los precios del catalogo cambien (grandfathering).
          </p>
        </section>
      )}
    </div>
  )
}
