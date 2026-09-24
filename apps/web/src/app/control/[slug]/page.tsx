import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  StatCard,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  Badge,
  Mono,
} from '@regb/ui'
import { loadClientDetail } from '@/lib/control'
import { listInvoices } from '@/lib/invoicing'
import { requireProvider } from '@/lib/provider-guard'
import { cycleLabel, InvoiceBreakdown, StatusBadge, TierBadge, usd } from '@/components/ControlBits'
import { impersonar, pasarAPago } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { DesgloseFactura, ESTADO_FACTURA, mesDe } from '../facturacion/piezas'

export const dynamic = 'force-dynamic'

const CATEGORY_LABEL: Record<string, string> = {
  core: 'Básico',
  standard: 'Estándar',
  advanced: 'Avanzado',
  vertical: 'Vertical',
  enterprise: 'Enterprise',
}

const CAMPO =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

/**
 * Ficha 360 del cliente (§12.5): que paga, por que lo paga, que tiene
 * activo y que debe. "Próxima factura" es exactamente lo que el motor
 * persistira en `invoices.lines` cuando se emita la del ciclo -uso medido,
 * ITBIS e instalaciones pendientes incluidos (0128)-; la prueba
 * `factura-mensual.accion.test.ts` compara las dos linea por linea.
 *
 * Desde aqui se cierra la venta: un modulo en prueba (o una prueba que
 * vencio hace poco) pasa a pago con dos clics. Antes no habia boton y la
 * prueba se apagaba sola a los 14 dias.
 */
export default async function ClientDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireProvider()
  const { slug } = await params
  const data = await loadClientDetail(slug)
  if (!data) notFound()
  const facturas = await listInvoices(slug)

  const { client, invoice, installation, modules, usage, taxRate, pendingInstall, expiredTrials } =
    data
  const fecha = (iso: string | null) =>
    iso
      ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-DO', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—'

  const dePago = modules.filter((m) => m.category !== 'core')
  const basicos = modules.filter((m) => m.category === 'core')
  const debe = facturas.filter((f) => f.status === 'sent' || f.status === 'overdue')

  const pasarForm = (moduleId: string, nombre: string, texto: string) => (
    <details>
      <summary className="inline-flex h-8 cursor-pointer list-none items-center justify-end rounded-full px-3 text-xs font-semibold text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] [&::-webkit-details-marker]:hidden">
        {texto}
      </summary>
      <form action={pasarAPago} className="mt-1 flex flex-col items-end gap-1.5">
        <input type="hidden" name="slug" value={client.slug} />
        <input type="hidden" name="moduleId" value={moduleId} />
        <p className="max-w-56 text-right text-xs text-[var(--color-text-secondary)]">
          {nombre} queda de pago desde ya; la próxima factura cobra su instalación y su mensualidad.
        </p>
        <BotonEnvio className="flex h-8 items-center rounded-full bg-[var(--color-brand)] px-3 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
          Sí, pasar a pago
        </BotonEnvio>
      </form>
    </details>
  )

  return (
    <div className="space-y-6">
      <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
        <Link href="/control" className="text-[var(--color-text-link)] hover:underline">
          Clientes
        </Link>{' '}
        › {client.legalName}
      </nav>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{client.legalName}</h1>
        <TierBadge tier={client.tier} />
        <StatusBadge status={client.status} />
        {client.healthScore !== null && (
          <Badge
            tone={
              client.healthScore >= 70 ? 'success' : client.healthScore >= 40 ? 'warning' : 'danger'
            }
          >
            Salud {client.healthScore}
          </Badge>
        )}
        <span className="text-xs text-[var(--color-text-muted)]">
          <Mono>{client.slug}</Mono>
        </span>
      </header>

      {/* Impersonacion §7.4: razon obligatoria, 60 min, doble bitacora. */}
      <details className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Entrar como este cliente
        </summary>
        <form action={impersonar} className="flex flex-wrap items-end gap-3 px-4 pb-4">
          <input type="hidden" name="slug" value={client.slug} />
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Razón (obligatoria, mínimo 10 caracteres; queda en la bitácora del cliente)
            <input
              name="reason"
              required
              minLength={10}
              placeholder="Soporte ticket #123: revisar factura duplicada"
              className={CAMPO}
            />
          </label>
          <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Ticket
            <input name="ticket" placeholder="T-123" className={CAMPO} />
          </label>
          {/* Sobre la barra negra/clara el texto va del color del fondo: en
              oscuro la barra es casi blanca y el blanco fijo no se veia. */}
          <BotonEnvio className="h-10 rounded-full bg-[var(--color-accent-plum)] px-4 text-sm font-semibold text-[var(--color-surface-base)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
            Entrar 60 min
          </BotonEnvio>
        </form>
      </details>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Mensualidad"
          value={usd(client.monthlyTotal)}
          hint={`${cycleLabel(client.billingCycle)} · ${usd(client.monthlyNet)} sin ITBIS`}
        />
        <StatCard
          label="Debe"
          value={usd(debe.reduce((a, f) => a + f.total, 0))}
          hint={
            debe.length === 0
              ? 'al día'
              : `${debe.length} factura${debe.length === 1 ? '' : 's'} sin pagar`
          }
        />
        <StatCard
          label="Módulos de pago"
          value={String(client.paidModules)}
          hint={
            client.trialModules > 0 ? `+ ${client.trialModules} en prueba` : 'ninguno en prueba'
          }
        />
        <StatCard
          label="Renueva"
          value={fecha(client.renewsAt)}
          hint={`en vivo desde ${fecha(client.goLiveAt)}`}
        />
      </section>

      <section aria-label="Desgloses" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Próxima factura</CardTitle>
          </CardHeader>
          <CardBody>
            <InvoiceBreakdown result={invoice} />
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Uso medido hoy: {usage.activeUsers} usuario(s) activo(s) · {usage.branches}{' '}
              sucursal(es) · {usage.companies} empresa(s) · {usage.storageGb} GB en archivos.
              Transacciones: sin medir todavía, van en 0.{' '}
              {taxRate > 0
                ? `ITBIS ${Math.round(taxRate * 100)} % porque el cliente es de RD.`
                : 'Sin ITBIS: el cliente no es de RD.'}
              {pendingInstall.length > 0 &&
                ` Incluye, una sola vez, la instalación de: ${pendingInstall.join(', ')}.`}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Instalación de lo activo (referencia)</CardTitle>
          </CardHeader>
          <CardBody>
            <InvoiceBreakdown result={installation} />
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Lo que costaría instalar hoy el plan y todo lo activo, por si hay que cotizarlo. No se
              factura: la próxima factura solo lleva la instalación de lo recién activado.
            </p>
          </CardBody>
        </Card>
      </section>

      <section aria-label="Facturas del cliente" className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Facturas ({facturas.length})
        </h2>
        {facturas.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Todavía no se le ha emitido ninguna. Se emiten desde{' '}
            <Link href="/control/facturacion" className="text-[var(--color-text-link)] underline">
              Facturación
            </Link>
            .
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Número</TH>
                <TH>Período</TH>
                <TH>Estado</TH>
                <TH>Vence</TH>
                <TH numeric>ITBIS</TH>
                <TH numeric>Total</TH>
              </TR>
            </THead>
            <TBody>
              {facturas.map((f) => {
                const st = ESTADO_FACTURA[f.status] ?? { label: f.status, tone: 'neutral' as const }
                return (
                  <TR key={f.id}>
                    <TD>
                      <Mono>{f.number}</Mono>
                      <DesgloseFactura lineas={f.lines} total={f.total} />
                    </TD>
                    <TD>{mesDe(f.periodStart)}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD>{fecha(f.dueAt)}</TD>
                    <TD numeric>
                      <span className="tabular">{usd(f.tax)}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{usd(f.total)}</span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-label="Módulos" className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Módulos de pago y en prueba ({dePago.length})
        </h2>
        {dePago.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Solo tiene los básicos.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Módulo</TH>
                <TH>Categoría</TH>
                <TH>Estado</TH>
                <TH>Activado</TH>
                <TH numeric>Precio negociado</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {dePago.map((m) => (
                <TR key={m.moduleId}>
                  <TD className="font-semibold text-[var(--color-text-primary)]">{m.name}</TD>
                  <TD>{CATEGORY_LABEL[m.category] ?? m.category}</TD>
                  <TD>
                    <StatusBadge status={m.status} />
                    {m.status === 'trial' && m.trialEndsAt && (
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        hasta {fecha(m.trialEndsAt)}
                      </span>
                    )}
                  </TD>
                  <TD>{fecha(m.activatedAt)}</TD>
                  <TD numeric>
                    {m.priceOverride !== null ? (
                      <span className="tabular">{usd(m.priceOverride)}</span>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">de catálogo</span>
                    )}
                  </TD>
                  <TD>{m.status === 'trial' && pasarForm(m.moduleId, m.name, 'Pasar a pago…')}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {expiredTrials.length > 0 && (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] p-3">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
              Pruebas que vencieron sin cerrarse
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              El cliente ya no las ve, pero sus datos siguen ahí. Si decidió quedarse con alguna,
              pásala a pago.
            </p>
            <ul className="mt-2 divide-y divide-[var(--color-border)] text-sm">
              {expiredTrials.map((t) => (
                <li key={t.moduleId} className="flex flex-wrap items-start gap-3 py-2">
                  <span className="min-w-0 flex-1 text-[var(--color-text-primary)]">
                    {t.name}
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      venció el {fecha(t.endedOn)}
                    </span>
                  </span>
                  {pasarForm(t.moduleId, t.name, 'Activar de pago…')}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-[var(--color-text-muted)]">
          Además tiene {basicos.length} módulos básicos, gratis en todos los planes:{' '}
          {basicos.map((m) => m.name).join(', ')}.
        </p>
      </section>
    </div>
  )
}
