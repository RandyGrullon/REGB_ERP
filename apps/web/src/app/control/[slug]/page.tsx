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
} from '@regb/ui'
import { loadClientDetail } from '@/lib/control'
import { requireProvider } from '@/lib/provider-guard'
import { cycleLabel, InvoiceBreakdown, StatusBadge, TierBadge, usd } from '@/components/ControlBits'
import { impersonar } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

const CATEGORY_LABEL: Record<string, string> = {
  core: 'Core',
  standard: 'Estandar',
  advanced: 'Avanzado',
  vertical: 'Vertical',
  enterprise: 'Enterprise',
}

/**
 * Ficha 360 del cliente (§12.5): que paga, por que lo paga y que tiene
 * activo. "Proxima factura" es exactamente lo que el motor persistira en
 * `invoices.lines` cuando se emita la del ciclo -uso medido, ITBIS e
 * instalaciones pendientes incluidos (0128)-; la prueba
 * `factura-mensual.accion.test.ts` compara las dos linea por linea.
 */
export default async function ClientDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireProvider()
  const { slug } = await params
  const data = await loadClientDetail(slug)
  if (!data) notFound()

  const { client, invoice, installation, modules, usage, taxRate, pendingInstall } = data
  const fecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString('es-DO', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—'

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
      </header>

      {/* Impersonacion §7.4: razon obligatoria, 60 min, doble bitacora. */}
      <details className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--color-text-primary)]">
          Impersonar a este cliente
        </summary>
        <form action={impersonar} className="flex flex-wrap items-end gap-3 px-4 pb-4">
          <input type="hidden" name="slug" value={client.slug} />
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Razon (obligatoria, minimo 10 caracteres — queda en la bitacora del cliente)
            <input
              name="reason"
              required
              minLength={10}
              placeholder="Soporte ticket #123: revisar factura duplicada"
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Ticket
            <input
              name="ticket"
              placeholder="T-123"
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <BotonEnvio
            
            className="h-10 rounded-full bg-[var(--color-accent-plum)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
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
        <StatCard label="Instalacion" value={usd(client.installTotal)} hint="pago unico" />
        <StatCard
          label="Modulos de pago"
          value={String(client.paidModules)}
          hint={
            client.trialModules > 0 ? `+ ${client.trialModules} en prueba` : 'ninguno en prueba'
          }
        />
        <StatCard
          label="Renueva"
          value={fecha(client.renewsAt)}
          hint={`cliente desde ${fecha(client.goLiveAt)}`}
        />
      </section>

      <section aria-label="Desgloses" className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Proxima factura</CardTitle>
          </CardHeader>
          <CardBody>
            <InvoiceBreakdown result={invoice} />
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Uso medido hoy: {usage.activeUsers} usuario(s) activo(s) · {usage.branches}{' '}
              sucursal(es) · {usage.companies} empresa(s) · {usage.storageGb} GB en archivos.
              Transacciones: sin medir todavia, van en 0.{' '}
              {taxRate > 0
                ? `ITBIS ${Math.round(taxRate * 100)} % porque el cliente es de RD.`
                : 'Sin ITBIS: el cliente no es de RD.'}
              {pendingInstall.length > 0 &&
                ` Incluye, una sola vez, la instalacion de: ${pendingInstall.join(', ')}.`}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Instalacion de lo activo (referencia)</CardTitle>
          </CardHeader>
          <CardBody>
            <InvoiceBreakdown result={installation} />
          </CardBody>
        </Card>
      </section>

      <section aria-label="Modulos">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
          Modulos activos ({modules.length})
        </h2>
        <Table>
          <THead>
            <TR>
              <TH>Modulo</TH>
              <TH>Categoria</TH>
              <TH>Estado</TH>
              <TH>Activado</TH>
              <TH numeric>Precio negociado</TH>
            </TR>
          </THead>
          <TBody>
            {modules.map((m) => (
              <TR key={m.moduleId}>
                <TD className="font-medium text-[var(--color-text-primary)]">{m.name}</TD>
                <TD>{CATEGORY_LABEL[m.category] ?? m.category}</TD>
                <TD>
                  <StatusBadge status={m.status} />
                </TD>
                <TD>{fecha(m.activatedAt)}</TD>
                <TD numeric>
                  {m.priceOverride !== null ? (
                    <span className="tabular">{usd(m.priceOverride)}</span>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">catalogo</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Los modulos core son gratis en todos los tiers y no aparecen en el desglose de precios.
        </p>
      </section>
    </div>
  )
}
