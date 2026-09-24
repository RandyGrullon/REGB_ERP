import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearSolicitudForm } from './actions'
import { ESTADO_FIRMA, TIPO_DOCUMENTO_FIRMA } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Firma electrónica · REGB ERP' }

interface SolicitudRow {
  id: string
  document_type: string
  document_label: string
  signer_name: string
  status: string
}

interface CotizacionOption {
  id: string
  quote_number: string
  version: number
}

const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'signed') return 'success'
  if (s === 'declined' || s === 'expired') return 'danger'
  if (s === 'sent') return 'warning'
  return 'neutral'
}

/** Firma electronica (modulo 91): flujo de clic para firmar con rastro de auditoria real. */
export default async function FirmaElectronicaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'e-sign')

  const { solicitudes, cotizaciones } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const s = await tx<SolicitudRow[]>`
      select id, document_type, document_label, signer_name, status
      from public.signature_requests
      where tenant_id = ${ctx.tenantId}
      order by created_at desc`
    const c = ctx.licensedModules.has('quotes')
      ? await tx<CotizacionOption[]>`
          select id, quote_number, version from public.quotes
          where tenant_id = ${ctx.tenantId} and status != 'superseded'
          order by created_at desc limit 100`
      : []
    return { solicitudes: s, cotizaciones: c }
  })

  const pendientes = solicitudes.filter((s) => s.status === 'sent').length
  const puedeGestionar = exigir(ctx, 'e-sign', 'e-sign.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/firma-electronica">
      <div className="space-y-5">
        <PageHeader
          icon="draw"
          title="Firma electronica"
          description="Flujo de clic para firmar con rastro de auditoria real -quien, cuando, desde que IP-. No es una firma certificada con PKI."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Solicitudes" value={String(solicitudes.length)} />
          <StatCard label="Esperando firma" value={String(pendientes)} />
        </section>

        {solicitudes.length === 0 ? (
          <EmptyState
            icon="draw"
            title="Todavia no hay ninguna solicitud"
            description="Crea la primera abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Documento</TH>
                <TH>Tipo</TH>
                <TH>Firmante</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {solicitudes.map((s) => (
                <TR key={s.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a
                      href={`/firma-electronica/${s.id}${qs}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {s.document_label}
                    </a>
                  </TD>
                  <TD>{TIPO_DOCUMENTO_FIRMA[s.document_type] ?? s.document_type}</TD>
                  <TD className="text-[var(--color-text-muted)]">{s.signer_name}</TD>
                  <TD>
                    <Badge tone={badgeEstado(s.status)}>{ESTADO_FIRMA[s.status] ?? s.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <div className="grid gap-5 lg:grid-cols-2">
            {cotizaciones.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Firmar una cotizacion</CardTitle>
                </CardHeader>
                <CardBody>
                  <form action={crearSolicitudForm} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <input type="hidden" name="documentType" value="quote" />
                    <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Cotizacion
                      <select
                        name="quoteChoice"
                        required
                        className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                      >
                        {cotizaciones.map((c) => (
                          <option key={c.id} value={`${c.id}|${c.quote_number} v${c.version}`}>
                            {c.quote_number} v{c.version}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Nombre de quien firma
                      <input
                        name="signerName"
                        required
                        className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                      />
                    </label>
                    <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Correo de quien firma
                      <input
                        name="signerEmail"
                        type="email"
                        required
                        className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                      />
                    </label>
                    <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                      <Icon name="add" size={14} />
                      Crear
                    </BotonEnvio>
                  </form>
                </CardBody>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Firmar otro documento</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={crearSolicitudForm} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="documentType" value="other" />
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Etiqueta del documento
                    <input
                      name="manualLabel"
                      required
                      placeholder="Ej. Acuerdo de confidencialidad"
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Nombre de quien firma
                    <input
                      name="signerName"
                      required
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Correo de quien firma
                    <input
                      name="signerEmail"
                      type="email"
                      required
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="add" size={14} />
                    Crear
                  </BotonEnvio>
                </form>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </Shell>
  )
}
