import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  Mono,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import type { EstadoFirma } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { transicionarSolicitudForm } from '../actions'
import { ESTADO_FIRMA, TIPO_DOCUMENTO_FIRMA } from '../estados'

export const dynamic = 'force-dynamic'

interface SolicitudHead {
  id: string
  document_type: string
  document_label: string
  signer_name: string
  signer_email: string
  status: EstadoFirma
  declined_reason: string | null
  ip_address: string | null
  signed_hash: string | null
  signed_at: string | null
}

interface EventoRow {
  id: string
  event_type: string
  ip_address: string | null
  occurred_at: string
}

const fecha = (iso: string) => new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'signed') return 'success'
  if (s === 'declined' || s === 'expired') return 'danger'
  if (s === 'sent') return 'warning'
  return 'neutral'
}
const ETIQUETA_EVENTO: Record<string, string> = {
  created: 'Creada',
  sent: 'Enviada',
  viewed: 'Vista',
  signed: 'Firmada',
  declined: 'Rechazada',
  expired: 'Vencida',
}

/** Detalle de una solicitud de firma (modulo 91): su maquina de estados y su rastro de auditoria. */
export default async function SolicitudDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'e-sign')

  const { head, eventos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<SolicitudHead[]>`
      select id, document_type, document_label, signer_name, signer_email, status,
             declined_reason, ip_address, signed_hash, signed_at::text
      from public.signature_requests
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, eventos: [] }

    const e = await tx<EventoRow[]>`
      select id, event_type, ip_address, occurred_at::text
      from public.signature_events
      where request_id = ${id} and tenant_id = ${ctx.tenantId}
      order by occurred_at`

    return { head: h, eventos: e }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'e-sign', 'e-sign.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="requestId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/firma-electronica">
      <div className="space-y-5">
        <PageHeader
          icon="draw"
          title={head.document_label}
          crumbs={[{ label: 'Firma electronica', href: `/firma-electronica${qs}` }, { label: 'Detalle' }]}
          actions={<Badge tone={badgeEstado(head.status)}>{ESTADO_FIRMA[head.status] ?? head.status}</Badge>}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Tipo" value={TIPO_DOCUMENTO_FIRMA[head.document_type] ?? head.document_type} />
          <StatCard label="Firmante" value={head.signer_name} />
          <StatCard label="Correo" value={head.signer_email} />
        </section>

        {head.declined_reason && (
          <p className="text-xs text-[var(--color-semantic-text-danger)]">
            <Icon name="info" size={12} /> Rechazada: {head.declined_reason}
          </p>
        )}

        {head.status === 'signed' && (
          <Card>
            <CardHeader>
              <CardTitle>Rastro de la firma</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                Firmada el {head.signed_at && fecha(head.signed_at)} desde la IP{' '}
                <Mono>{head.ip_address ?? 'desconocida'}</Mono>
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Huella del documento firmado: <Mono>{head.signed_hash}</Mono>
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Esto es trazabilidad real -quien, cuando, desde donde-, no una firma certificada con PKI.
              </p>
            </CardBody>
          </Card>
        )}

        {puedeGestionar && (
          <div className="flex flex-wrap gap-2">
            {head.status === 'pending' && (
              <form action={transicionarSolicitudForm}>
                {campos}
                <input type="hidden" name="siguiente" value="sent" />
                <button type="submit" className={botonClase}>
                  <Icon name="send" size={14} />
                  Enviar a firmar
                </button>
              </form>
            )}
            {head.status === 'sent' && (
              <>
                <form action={transicionarSolicitudForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="signed" />
                  <button type="submit" className={botonClase}>
                    <Icon name="draw" size={14} />
                    Firmar
                  </button>
                </form>
                <form action={transicionarSolicitudForm} className="flex items-end gap-2">
                  {campos}
                  <input type="hidden" name="siguiente" value="declined" />
                  <input name="declinedReason" placeholder="Motivo" className={claseInput} />
                  <button type="submit" className={botonSecundarioClase}>
                    Rechazar
                  </button>
                </form>
                <form action={transicionarSolicitudForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="expired" />
                  <button type="submit" className={botonSecundarioClase}>
                    Marcar vencida
                  </button>
                </form>
              </>
            )}
          </div>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Evento</TH>
              <TH>IP</TH>
              <TH>Fecha</TH>
            </TR>
          </THead>
          <TBody>
            {eventos.map((e) => (
              <TR key={e.id}>
                <TD className="text-[var(--color-text-primary)]">{ETIQUETA_EVENTO[e.event_type] ?? e.event_type}</TD>
                <TD className="text-[var(--color-text-muted)]">
                  <Mono>{e.ip_address ?? '—'}</Mono>
                </TD>
                <TD className="text-[var(--color-text-muted)]">{fecha(e.occurred_at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </Shell>
  )
}
