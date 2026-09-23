import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  PageHeader,
  StatCard,
} from '@regb/ui'
import { forecastPonderado } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearOportunidadForm, transicionarEtapaForm } from './actions'
import { ETAPAS_KANBAN, ETAPA_OPORTUNIDAD } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Oportunidades · REGB ERP' }

interface OportunidadRow {
  id: string
  name: string
  amount: string
  probability: string
  stage: string
  lead_name: string | null
}

interface LeadOption {
  id: string
  name: string
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const siguienteEtapa: Record<string, string> = {
  prospecting: 'qualification',
  qualification: 'proposal',
  proposal: 'negotiation',
  negotiation: 'won',
}

/** Oportunidades / Pipeline (modulo 30): kanban de etapas y forecast ponderado real. */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'pipeline')

  const { oportunidades, leads } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const o = await tx<OportunidadRow[]>`
      select op.id, op.name, op.amount::text, op.probability::text, op.stage, l.name as lead_name
      from public.opportunities op
      left join public.leads l on l.id = op.lead_id
      where op.tenant_id = ${ctx.tenantId}
      order by op.updated_at desc`
    const l = await tx<LeadOption[]>`
      select id, name from public.leads where tenant_id = ${ctx.tenantId} order by name limit 300`
    return { oportunidades: o, leads: l }
  })

  const abiertas = oportunidades.filter((o) => o.stage !== 'won' && o.stage !== 'lost')
  const ganadas = oportunidades.filter((o) => o.stage === 'won')
  const forecast = forecastPonderado(abiertas.map((o) => ({ amount: Number(o.amount), probability: Number(o.probability) })))

  const puedeGestionar = exigir(ctx, 'pipeline', 'pipeline.manage').ok
  const qs = ctx.demoQs
  const campos = (id: string) => (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="oportunidadId" value={id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/pipeline">
      <div className="space-y-5">
        <PageHeader
          icon="trending_up"
          title="Oportunidades"
          description="El forecast suma cada monto por SU propia probabilidad, nunca el monto crudo de todo lo abierto."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Oportunidades abiertas" value={String(abiertas.length)} />
          <StatCard label="Forecast ponderado" value={`RD$ ${money(forecast)}`} />
          <StatCard label="Ganadas" value={String(ganadas.length)} />
        </section>

        <div className="grid gap-3 lg:grid-cols-4">
          {ETAPAS_KANBAN.map((etapa) => (
            <div key={etapa} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                {ETAPA_OPORTUNIDAD[etapa]} ({abiertas.filter((o) => o.stage === etapa).length})
              </h2>
              <div className="space-y-2">
                {abiertas
                  .filter((o) => o.stage === etapa)
                  .map((o) => (
                    <div
                      key={o.id}
                      className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3"
                    >
                      <a href={`/pipeline/${o.id}${qs}`} className="block text-sm font-medium text-[var(--color-text-primary)] underline-offset-2 hover:underline">
                        {o.name}
                      </a>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        RD$ {money(Number(o.amount))} · {(Number(o.probability) * 100).toFixed(0)}%
                      </p>
                      {o.lead_name && <p className="text-xs text-[var(--color-text-muted)]">Lead: {o.lead_name}</p>}
                      {puedeGestionar && (
                        <div className="flex gap-1.5">
                          <form action={transicionarEtapaForm}>
                            {campos(o.id)}
                            <input type="hidden" name="siguiente" value={siguienteEtapa[o.stage]} />
                            <BotonEnvio
                              
                              className="flex h-7 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                              <Icon name="arrow_forward" size={12} />
                              {ETAPA_OPORTUNIDAD[siguienteEtapa[o.stage]!]}
                            </BotonEnvio>
                          </form>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva oportunidad</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearOportunidadForm} className="flex flex-wrap items-end gap-3">
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
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto (RD$)
                  <input name="amount" required inputMode="decimal" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular" />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Lead de origen (opcional)
                  <select name="leadId" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]">
                    <option value="">Sin lead de origen</option>
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
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
