import Link from 'next/link'
import { Badge, StatCard, Table, THead, TBody, TR, TH, TD, EmptyState, Icon, Mono } from '@regb/ui'
import { listInvoices, previewMonthlyInvoices } from '@/lib/invoicing'
import { requireProvider } from '@/lib/provider-guard'
import { usd } from '@/components/ControlBits'
import { aplicarDunning, generarFacturasDelMes, registrarPago } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { DesgloseFactura, ESTADO_FACTURA, mesDe } from './piezas'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Facturación · REGB Control' }

const fecha = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const PILA_SECUNDARIA =
  'inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 text-sm font-semibold text-[var(--color-text-primary)] transition-colors duration-100 hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] [&::-webkit-details-marker]:hidden'
const PILA_PRIMARIA =
  'inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors duration-100 hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] [&::-webkit-details-marker]:hidden'

/**
 * Facturacion (S16): emision idempotente y cobro manual.
 *
 * Las tres acciones que mueven dinero o degradan a un cliente van en dos
 * pasos: el primero ENSENA lo que va a pasar (la corrida cliente por
 * cliente, el monto del pago, que hace la cobranza) y el segundo lo hace.
 * Antes eran botones de un clic: "Generar facturas del mes" emitia a todos
 * sin ver un total, y un cliente mal cotizado se descubria ya facturado.
 *
 * "Generar" se puede pulsar mil veces: el indice unico (tenant, periodo)
 * garantiza una factura por cliente por mes. "Registrar pago" pasa por
 * regb.record_payment, que deduplica.
 */
export default async function FacturacionPage() {
  await requireProvider()
  const [invoices, corrida] = await Promise.all([listInvoices(), previewMonthlyInvoices()])

  const cobrado = invoices.filter((i) => i.status === 'paid').reduce((a, i) => a + i.total, 0)
  const pendientes = invoices.filter((i) => i.status === 'sent' || i.status === 'overdue')
  const pendiente = pendientes.reduce((a, i) => a + i.total, 0)
  const vencidas = invoices.filter((i) => i.status === 'overdue')
  const itbis = invoices.filter((i) => i.status !== 'void').reduce((a, i) => a + i.tax, 0)

  const aEmitir = corrida.rows.filter((r) => r.total !== null)
  const totalCorrida = aEmitir.reduce((a, r) => a + (r.total ?? 0), 0)
  const mes = mesDe(corrida.period)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
            <Link href="/control" className="text-[var(--color-text-link)] hover:underline">
              Clientes
            </Link>{' '}
            › Facturación
          </nav>
          <h1 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">Facturación</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-start gap-2">
          <details className="relative">
            <summary className={PILA_SECUNDARIA}>
              <Icon name="gavel" size={18} />
              Revisar la mora…
            </summary>
            <form
              action={aplicarDunning}
              className="absolute right-0 z-10 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-sm text-[var(--color-text-secondary)]"
            >
              <p>
                Marca como vencidas las facturas que pasaron su fecha y aplica la cobranza según los
                días de atraso: aviso a los 5 y 10, <strong>solo lectura a los 15</strong>,
                suspensión a los 30 y archivo a los 90. Quien ya pagó vuelve a activo. No borra
                nada.
              </p>
              <p className="text-xs">
                {vencidas.length === 0
                  ? 'Hoy no hay facturas vencidas.'
                  : `${vencidas.length} factura${vencidas.length === 1 ? '' : 's'} vencida${vencidas.length === 1 ? '' : 's'} por ${usd(vencidas.reduce((a, i) => a + i.total, 0))}.`}
              </p>
              <BotonEnvio className="flex h-10 items-center rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                Aplicar la cobranza
              </BotonEnvio>
            </form>
          </details>
        </div>
      </div>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Facturas" value={String(invoices.length)} hint="emitidas en total" />
        <StatCard label="Cobrado" value={usd(cobrado)} hint="pagadas" />
        <StatCard
          label="Por cobrar"
          value={usd(pendiente)}
          hint={
            vencidas.length > 0
              ? `${vencidas.length} vencida${vencidas.length === 1 ? '' : 's'}`
              : 'ninguna vencida'
          }
        />
        <StatCard label="ITBIS facturado" value={usd(itbis)} hint="es de la DGII, no ingreso" />
      </section>

      {/* La corrida del mes: primero se ve, despues se emite. */}
      <section
        aria-label={`Facturas de ${mes}`}
        className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Facturas de {mes}
            </h2>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {aEmitir.length === 0
                ? 'No hay nada por emitir: cada cliente que factura ya tiene la suya.'
                : `Faltan ${aEmitir.length} por emitir, por ${usd(totalCorrida)} con ITBIS. Revisa la lista antes de emitir: sale tal cual.`}
            </p>
          </div>
          {aEmitir.length > 0 && (
            <details className="w-full sm:w-auto">
              <summary className={PILA_PRIMARIA}>
                <Icon name="receipt_long" size={18} />
                Emitir facturas…
              </summary>
              <form
                action={generarFacturasDelMes}
                className="mt-2 flex flex-wrap items-center gap-2"
              >
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Se emiten {aEmitir.length} y se le cobran al cliente. Una factura emitida no se
                  borra.
                </p>
                <BotonEnvio className="flex h-10 items-center rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  Sí, emitir {aEmitir.length} por {usd(totalCorrida)}
                </BotonEnvio>
              </form>
            </details>
          )}
        </div>
        <ul className="mt-3 divide-y divide-[var(--color-border)] text-sm">
          {corrida.rows.map((r) => (
            <li key={r.slug} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
              <Link
                href={`/control/${r.slug}`}
                className="min-w-0 flex-1 text-[var(--color-text-link)] hover:underline"
              >
                {r.tenant}
              </Link>
              {r.total === null ? (
                <span className="text-xs text-[var(--color-text-muted)]">{r.skip}</span>
              ) : (
                <>
                  {r.installation > 0 && (
                    <Badge tone="warning" dot={false}>
                      incluye {usd(r.installation)} de instalación
                    </Badge>
                  )}
                  <span className="tabular text-xs text-[var(--color-text-muted)]">
                    ITBIS {usd(r.tax)}
                  </span>
                  <span className="tabular font-semibold text-[var(--color-text-primary)]">
                    {usd(r.total)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {invoices.length === 0 ? (
        <EmptyState
          icon="receipt_long"
          title="Todavía no hay facturas"
          description="Emite las del mes desde el recuadro de arriba: una por cliente que factura, calculada por el motor de precios. Emitir dos veces no duplica nada."
        />
      ) : (
        <section aria-label="Facturas emitidas" className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Facturas emitidas
          </h2>
          <Table>
            <THead>
              <TR>
                <TH>Número</TH>
                <TH>Cliente</TH>
                <TH>Período</TH>
                <TH>Estado</TH>
                <TH>Vence</TH>
                <TH numeric>ITBIS</TH>
                <TH numeric>Total</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {invoices.map((inv) => {
                const st = ESTADO_FACTURA[inv.status] ?? {
                  label: inv.status,
                  tone: 'neutral' as const,
                }
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
                      <DesgloseFactura lineas={inv.lines} total={inv.total} />
                    </TD>
                    <TD>{mesDe(inv.periodStart)}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD>{fecha(inv.dueAt)}</TD>
                    <TD numeric>
                      <span className="tabular">{usd(inv.tax)}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{usd(inv.total)}</span>
                    </TD>
                    <TD>
                      {(inv.status === 'sent' || inv.status === 'overdue') && (
                        <details>
                          <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] [&::-webkit-details-marker]:hidden">
                            Registrar pago…
                          </summary>
                          <form action={registrarPago} className="mt-2 space-y-2">
                            <input type="hidden" name="invoiceId" value={inv.id} />
                            <p className="max-w-56 text-xs text-[var(--color-text-secondary)]">
                              Confirma que recibiste {usd(inv.total)} completos de {inv.tenantName}.
                            </p>
                            <BotonEnvio className="flex h-8 items-center rounded-full bg-[var(--color-brand)] px-3 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                              Sí, lo recibí
                            </BotonEnvio>
                          </form>
                        </details>
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
          <p className="text-xs text-[var(--color-text-muted)]">
            Cada factura guarda su desglose tal como se emitió: se puede reconstruir dentro de años
            aunque los precios del catálogo cambien.
          </p>
        </section>
      )}
    </div>
  )
}
