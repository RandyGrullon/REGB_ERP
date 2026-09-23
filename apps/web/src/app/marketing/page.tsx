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
import { crearCampanaForm } from './actions'
import { CANAL_CAMPANA, ESTADO_CAMPANA, ESTADO_LEAD_FILTRO, FUENTE_LEAD_FILTRO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Marketing & Campanas · REGB ERP' }

interface CampanaFila {
  id: string
  name: string
  channel: string
  status: string
  destinatarios: string
}

const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'sent') return 'success'
  if (s === 'cancelled') return 'danger'
  if (s === 'scheduled') return 'warning'
  return 'neutral'
}

/** Marketing & Campanas (modulo 37): enviar toma la foto real de los leads que hoy cumplen el segmento. */
export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'marketing')

  const campanas = await asUser(ctx.userId, ctx.tenantId, (tx) => tx<CampanaFila[]>`
    select c.id, c.name, c.channel, c.status,
           (select count(*)::text from public.campaign_recipients where campaign_id = c.id) as destinatarios
    from public.campaigns c
    where c.tenant_id = ${ctx.tenantId}
    order by c.created_at desc`)

  const enCurso = campanas.filter((c) => c.status === 'draft' || c.status === 'scheduled').length
  const puedeGestionar = exigir(ctx, 'marketing', 'marketing.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/marketing">
      <div className="space-y-5">
        <PageHeader
          icon="campaign"
          title="Marketing & Campanas"
          description="Enviar toma la foto real de los leads que hoy cumplen el segmento -no manda ningun correo de verdad todavia-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Campanas" value={String(campanas.length)} />
          <StatCard label="En curso" value={String(enCurso)} />
        </section>

        {campanas.length === 0 ? (
          <EmptyState icon="campaign" title="Todavia no hay ninguna campana" description="Crea la primera abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Campana</TH>
                <TH>Canal</TH>
                <TH numeric>Destinatarios</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {campanas.map((c) => (
                <TR key={c.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/marketing/${c.id}${qs}`} className="underline-offset-2 hover:underline">
                      {c.name}
                    </a>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">{CANAL_CAMPANA[c.channel] ?? c.channel}</TD>
                  <TD numeric>
                    <span className="tabular">{c.destinatarios}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(c.status)}>{ESTADO_CAMPANA[c.status] ?? c.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva campana</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCampanaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Canal
                  <select
                    name="channel"
                    defaultValue="email"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="email">Correo</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Asunto (opcional)
                  <input
                    name="subject"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Mensaje
                  <input
                    name="message"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Segmento: estado
                  <select
                    name="targetStatus"
                    defaultValue=""
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Cualquiera</option>
                    {Object.entries(ESTADO_LEAD_FILTRO).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Segmento: fuente
                  <select
                    name="targetSource"
                    defaultValue=""
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Cualquiera</option>
                    {Object.entries(FUENTE_LEAD_FILTRO).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  UTM campaign
                  <input
                    name="utmCampaign"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
