import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
} from '@regb/ui'
import { diasEnPipeline, type EtapaAplicacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  cambiarEstadoVacanteForm,
  cambiarEtapaForm,
  crearAplicacionForm,
  programarEntrevistaForm,
} from '../actions'
import { ESTADO_VACANTE, ETAPA_APLICACION, RESULTADO_ENTREVISTA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface VacanteHead {
  id: string
  title: string
  department: string | null
  description: string | null
  status: string
}

interface AplicacionRow {
  id: string
  candidate_name: string
  stage: EtapaAplicacion
  applied_at: string
}

interface EntrevistaRow {
  id: string
  application_id: string
  scheduled_at: string
  interviewer_name: string | null
  outcome: string
}

interface CandidatoOption {
  id: string
  name: string
}

const SIGUIENTE_ETAPA: Partial<Record<EtapaAplicacion, EtapaAplicacion>> = {
  applied: 'screening',
  screening: 'interview',
  interview: 'offer',
  offer: 'hired',
}

const badgeTono = (etapa: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (etapa === 'hired') return 'success'
  if (etapa === 'rejected') return 'danger'
  if (etapa === 'applied') return 'neutral'
  return 'warning'
}

/** Pipeline de una vacante (modulo 65): candidatos, etapas y entrevistas. */
export default async function VacanteDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'recruiting')

  const { vacante, aplicaciones, entrevistas, candidatos } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [head] = await tx<VacanteHead[]>`
        select id, title, department, description, status from public.recruiting_positions
        where id = ${id} and tenant_id = ${ctx.tenantId}`

      if (!head) return { vacante: null, aplicaciones: [], entrevistas: [], candidatos: [] }

      const a = await tx<AplicacionRow[]>`
        select ra.id, c.first_name || ' ' || c.last_name as candidate_name, ra.stage, ra.applied_at::text
        from public.recruiting_applications ra
        join public.recruiting_candidates c on c.id = ra.candidate_id
        where ra.tenant_id = ${ctx.tenantId} and ra.position_id = ${id}
        order by ra.applied_at`

      const e = await tx<EntrevistaRow[]>`
        select ri.id, ri.application_id, ri.scheduled_at::text, ri.interviewer_name, ri.outcome
        from public.recruiting_interviews ri
        join public.recruiting_applications ra on ra.id = ri.application_id
        where ri.tenant_id = ${ctx.tenantId} and ra.position_id = ${id}
        order by ri.scheduled_at`

      const c = await tx<CandidatoOption[]>`
        select id, first_name || ' ' || last_name as name from public.recruiting_candidates
        where tenant_id = ${ctx.tenantId} order by last_name`

      return { vacante: head, aplicaciones: a, entrevistas: e, candidatos: c }
    },
  )

  if (!vacante) notFound()

  const entrevistasPorAplicacion = new Map<string, EntrevistaRow[]>()
  for (const en of entrevistas) {
    const lista = entrevistasPorAplicacion.get(en.application_id) ?? []
    lista.push(en)
    entrevistasPorAplicacion.set(en.application_id, lista)
  }

  const puedeGestionar = exigir(ctx, 'recruiting', 'recruiting.manage-pipeline').ok
  const puedeVacante = exigir(ctx, 'recruiting', 'recruiting.manage-positions').ok
  const qs = ctx.demoQs
  const hoy = new Date()

  const claseInput =
    'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/reclutamiento">
      <div className="space-y-5">
        <PageHeader
          icon="work"
          title={vacante.title}
          description={vacante.description ?? vacante.department ?? ''}
          crumbs={[{ label: 'Reclutamiento', href: `/reclutamiento${qs}` }, { label: vacante.title }]}
          actions={
            puedeVacante ? (
              <form action={cambiarEstadoVacanteForm} className="flex items-center gap-2">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="positionId" value={vacante.id} />
                <select name="status" defaultValue={vacante.status} className={claseInput}>
                  {Object.entries(ESTADO_VACANTE).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="save" size={14} />
                  Guardar
                </BotonEnvio>
              </form>
            ) : (
              <Badge tone="neutral">{ESTADO_VACANTE[vacante.status] ?? vacante.status}</Badge>
            )
          }
        />

        {aplicaciones.length === 0 ? (
          <EmptyState icon="groups" title="Todavia no hay ningun candidato aplicado" description="" />
        ) : (
          <div className="space-y-3">
            {aplicaciones.map((a) => {
              const siguiente = SIGUIENTE_ETAPA[a.stage]
              const esTerminal = a.stage === 'hired' || a.stage === 'rejected'
              return (
                <Card key={a.id}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-[var(--color-text-primary)]">{a.candidate_name}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {diasEnPipeline(new Date(a.applied_at), hoy)} dias en el pipeline
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={badgeTono(a.stage)}>{ETAPA_APLICACION[a.stage] ?? a.stage}</Badge>
                        {puedeGestionar && !esTerminal && (
                          <div className="flex gap-1.5">
                            {siguiente && (
                              <form action={cambiarEtapaForm}>
                                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                                <input type="hidden" name="applicationId" value={a.id} />
                                <input type="hidden" name="positionId" value={vacante.id} />
                                <input type="hidden" name="stage" value={siguiente} />
                                <BotonEnvio
                                  
                                  className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                                  Avanzar a {ETAPA_APLICACION[siguiente]}
                                </BotonEnvio>
                              </form>
                            )}
                            <form action={cambiarEtapaForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="applicationId" value={a.id} />
                              <input type="hidden" name="positionId" value={vacante.id} />
                              <input type="hidden" name="stage" value="rejected" />
                              <BotonEnvio
                                
                                className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                                Rechazar
                              </BotonEnvio>
                            </form>
                          </div>
                        )}
                      </div>
                    </div>

                    {(entrevistasPorAplicacion.get(a.id) ?? []).length > 0 && (
                      <ul className="space-y-1 border-t border-[var(--color-border-subtle)] pt-2">
                        {(entrevistasPorAplicacion.get(a.id) ?? []).map((en) => (
                          <li key={en.id} className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                            <span>
                              {new Date(en.scheduled_at).toLocaleString('es-DO', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                              {en.interviewer_name ? ` · ${en.interviewer_name}` : ''}
                            </span>
                            <span>{RESULTADO_ENTREVISTA[en.outcome] ?? en.outcome}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {puedeGestionar && !esTerminal && (
                      <form action={programarEntrevistaForm} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="applicationId" value={a.id} />
                        <input type="hidden" name="positionId" value={vacante.id} />
                        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                          Entrevista
                          <input type="datetime-local" name="scheduledAt" required className={claseInput} />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                          Con
                          <input name="interviewerName" className={claseInput} />
                        </label>
                        <BotonEnvio
                          
                          className="flex h-9 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                          <Icon name="event" size={14} />
                          Agendar
                        </BotonEnvio>
                      </form>
                    )}
                  </CardBody>
                </Card>
              )
            })}
          </div>
        )}

        {puedeGestionar && candidatos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Aplicar candidato</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearAplicacionForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="positionId" value={vacante.id} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Candidato
                  <select name="candidateId" required className={claseInput}>
                    {candidatos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nota
                  <input name="notes" className={claseInput} />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="send" size={14} />
                  Aplicar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
