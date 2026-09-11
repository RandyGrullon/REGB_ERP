import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import { tasaSobre, type EstadoCampana } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { enviarCampanaForm, marcarAperturaClicForm, transicionarCampanaForm } from '../actions'
import { CANAL_CAMPANA, ESTADO_CAMPANA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface CampanaHead {
  id: string
  name: string
  channel: string
  message: string
  status: EstadoCampana
  target_status: string | null
  target_source: string | null
  utm_campaign: string | null
}

interface Destinatario {
  id: string
  lead_name: string
  opened_at: string | null
  clicked_at: string | null
}

const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const botonChicoClase =
  'flex h-7 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'sent') return 'success'
  if (s === 'cancelled') return 'danger'
  if (s === 'scheduled') return 'warning'
  return 'neutral'
}
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(0)}%`)

/** Detalle de una campana (modulo 37): su segmento, sus destinatarios reales y su desempeno. */
export default async function CampanaDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'marketing')

  const { head, destinatarios } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<CampanaHead[]>`
      select id, name, channel, message, status, target_status, target_source, utm_campaign
      from public.campaigns where id = ${id} and tenant_id = ${ctx.tenantId}`
    const d = await tx<Destinatario[]>`
      select cr.id, l.name as lead_name, cr.opened_at::text, cr.clicked_at::text
      from public.campaign_recipients cr
      join public.leads l on l.id = cr.lead_id
      where cr.tenant_id = ${ctx.tenantId} and cr.campaign_id = ${id}
      order by cr.sent_at desc`
    return { head: h ?? null, destinatarios: d }
  })

  if (!head) notFound()

  const enviados = destinatarios.length
  const abiertos = destinatarios.filter((d) => d.opened_at !== null).length
  const clics = destinatarios.filter((d) => d.clicked_at !== null).length
  const tasaApertura = tasaSobre(abiertos, enviados)
  const tasaClics = tasaSobre(clics, abiertos)

  const puedeGestionar = exigir(ctx, 'marketing', 'marketing.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="campaignId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/marketing">
      <div className="space-y-5">
        <PageHeader
          icon="campaign"
          title={head.name}
          crumbs={[{ label: 'Marketing', href: `/marketing${qs}` }, { label: head.name }]}
          actions={<Badge tone={badgeEstado(head.status)}>{ESTADO_CAMPANA[head.status] ?? head.status}</Badge>}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Canal" value={CANAL_CAMPANA[head.channel] ?? head.channel} />
          <StatCard label="Destinatarios" value={String(enviados)} />
          <StatCard label="Tasa de apertura" value={pct(tasaApertura)} />
          <StatCard label="Tasa de clics" value={pct(tasaClics)} />
        </section>

        <p className="text-xs text-[var(--color-text-muted)]">{head.message}</p>

        {puedeGestionar && (
          <div className="flex flex-wrap gap-2">
            {head.status === 'draft' && (
              <>
                <form action={transicionarCampanaForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="scheduled" />
                  <BotonEnvio  className={botonSecundarioClase}>
                    Programar
                  </BotonEnvio>
                </form>
                <form action={enviarCampanaForm}>
                  {campos}
                  <BotonEnvio  className={botonClase}>
                    <Icon name="send" size={14} />
                    Enviar ahora
                  </BotonEnvio>
                </form>
                <form action={transicionarCampanaForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="cancelled" />
                  <BotonEnvio  className={botonSecundarioClase}>
                    Cancelar
                  </BotonEnvio>
                </form>
              </>
            )}
            {head.status === 'scheduled' && (
              <>
                <form action={enviarCampanaForm}>
                  {campos}
                  <BotonEnvio  className={botonClase}>
                    <Icon name="send" size={14} />
                    Enviar ahora
                  </BotonEnvio>
                </form>
                <form action={transicionarCampanaForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="cancelled" />
                  <BotonEnvio  className={botonSecundarioClase}>
                    Cancelar
                  </BotonEnvio>
                </form>
              </>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Destinatarios</CardTitle>
          </CardHeader>
          <CardBody>
            {destinatarios.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">Todavia no se ha enviado a nadie.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {destinatarios.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-[var(--color-text-primary)]">{d.lead_name}</span>
                    <div className="flex items-center gap-2">
                      {d.clicked_at ? (
                        <Badge tone="success">Clic</Badge>
                      ) : d.opened_at ? (
                        <Badge tone="warning">Abierto</Badge>
                      ) : (
                        <Badge tone="neutral">Enviado</Badge>
                      )}
                      {puedeGestionar && !d.opened_at && (
                        <form action={marcarAperturaClicForm}>
                          {campos}
                          <input type="hidden" name="recipientId" value={d.id} />
                          <input type="hidden" name="tipo" value="opened" />
                          <BotonEnvio  className={botonChicoClase}>
                            Marcar abierto
                          </BotonEnvio>
                        </form>
                      )}
                      {puedeGestionar && d.opened_at && !d.clicked_at && (
                        <form action={marcarAperturaClicForm}>
                          {campos}
                          <input type="hidden" name="recipientId" value={d.id} />
                          <input type="hidden" name="tipo" value="clicked" />
                          <BotonEnvio  className={botonChicoClase}>
                            Marcar clic
                          </BotonEnvio>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lo que esto no hace</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              Enviar no manda ningun correo ni WhatsApp de verdad -no hay integracion con un proveedor
              externo todavia-: toma la foto real de los leads que hoy cumplen el segmento y crea un
              destinatario por cada uno.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
