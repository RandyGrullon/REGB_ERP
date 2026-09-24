import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import type { EstadoOportunidad } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { transicionarEtapaForm } from '../actions'
import { ETAPA_OPORTUNIDAD } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface OportunidadHead {
  id: string
  name: string
  amount: string
  probability: string
  stage: EstadoOportunidad
  lost_reason: string | null
  expected_close_date: string | null
  lead_name: string | null
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const badgeEtapa = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'won') return 'success'
  if (s === 'lost') return 'danger'
  if (s === 'negotiation') return 'warning'
  return 'neutral'
}
const SIGUIENTE: Record<string, string> = {
  prospecting: 'qualification',
  qualification: 'proposal',
  proposal: 'negotiation',
  negotiation: 'won',
}

/** Detalle de una oportunidad (modulo 30): su maquina de estados y el motivo de perdida. */
export default async function OportunidadDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'pipeline')

  const head = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OportunidadHead[]>`
        select op.id, op.name, op.amount::text, op.probability::text, op.stage, op.lost_reason,
               op.expected_close_date::text, l.name as lead_name
        from public.opportunities op
        left join public.leads l on l.id = op.lead_id
        where op.id = ${id} and op.tenant_id = ${ctx.tenantId}`
    return h ?? null
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'pipeline', 'pipeline.manage').ok
  const qs = ctx.demoQs
  const enCurso = head.stage !== 'won' && head.stage !== 'lost'
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="oportunidadId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/pipeline">
      <div className="space-y-5">
        <PageHeader
          icon="trending_up"
          title={head.name}
          crumbs={[{ label: 'Oportunidades', href: `/pipeline${qs}` }, { label: head.name }]}
          actions={
            <Badge tone={badgeEtapa(head.stage)}>
              {ETAPA_OPORTUNIDAD[head.stage] ?? head.stage}
            </Badge>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Monto" value={`RD$ ${money(Number(head.amount))}`} />
          <StatCard
            label="Probabilidad"
            value={`${(Number(head.probability) * 100).toFixed(0)}%`}
          />
          <StatCard label="Lead de origen" value={head.lead_name ?? '—'} />
        </section>

        {head.lost_reason && (
          <p className="text-xs text-[var(--color-semantic-text-danger)]">
            <Icon name="info" size={12} /> Perdida: {head.lost_reason}
          </p>
        )}

        {puedeGestionar && enCurso && (
          <div className="flex flex-wrap gap-2">
            <form action={transicionarEtapaForm}>
              {campos}
              <input type="hidden" name="siguiente" value={SIGUIENTE[head.stage]} />
              <BotonEnvio className={botonClase}>
                <Icon name="arrow_forward" size={14} />
                Avanzar a {ETAPA_OPORTUNIDAD[SIGUIENTE[head.stage]!]}
              </BotonEnvio>
            </form>
            <form action={transicionarEtapaForm} className="flex items-end gap-2">
              {campos}
              <input type="hidden" name="siguiente" value="lost" />
              <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Motivo si se pierde
                <input
                  name="lostReason"
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                />
              </label>
              <BotonEnvio className={botonSecundarioClase}>Marcar perdida</BotonEnvio>
            </form>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Lo que esto no hace</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              La probabilidad se actualiza sola al valor por defecto de cada etapa al avanzar -no
              queda un número viejo de la etapa anterior olvidado en el forecast-. Una oportunidad
              no se puede marcar perdida sin explicar el motivo.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
