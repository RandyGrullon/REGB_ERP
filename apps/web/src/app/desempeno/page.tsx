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
import { progresoObjetivo, progresoResultadoClave, promedioEvaluacion360 } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  actualizarProgresoForm,
  completarUnoAUnoForm,
  crearObjetivoForm,
  crearPlanMejoraForm,
  crearResultadoClaveForm,
  crearUnoAUnoForm,
  enviarEvaluacionForm,
  resolverPlanMejoraForm,
} from './actions'
import { ESTADO_1ON1, ESTADO_OBJETIVO, ESTADO_PLAN_MEJORA, TIPO_EVALUACION } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Desempeno · REGB ERP' }

interface EmpleadoOption {
  id: string
  name: string
}

interface ObjetivoRow {
  id: string
  employee_name: string | null
  title: string
  period: string
  status: string
}

interface ResultadoClaveRow {
  id: string
  objective_id: string
  description: string
  target_value: string
  current_value: string
  unit: string | null
}

interface UnoAUnoRow {
  id: string
  employee_name: string
  scheduled_at: string
  status: string
  notes: string | null
  action_items: string | null
}

interface EvaluacionRow {
  id: string
  employee_name: string
  cycle: string
  review_type: string
  rating: number
}

interface PlanMejoraRow {
  id: string
  employee_name: string
  reason: string
  status: string
  start_date: string
  end_date: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'completed') return 'success'
  if (estado === 'active' || estado === 'scheduled') return 'warning'
  if (estado === 'cancelled') return 'danger'
  return 'neutral'
}

/** Desempeno (modulo 66): OKR con progreso derivado, 1:1, 360 y planes de mejora. */
export default async function DesempenoPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'performance')

  const { empleados, objetivos, resultados, unoAUnos, evaluaciones, planes } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const e = await tx<EmpleadoOption[]>`
        select id, first_name || ' ' || last_name as name from public.employees
        where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`

      const o = await tx<ObjetivoRow[]>`
        select po.id, e.first_name || ' ' || e.last_name as employee_name, po.title, po.period, po.status
        from public.performance_objectives po
        left join public.employees e on e.id = po.employee_id
        where po.tenant_id = ${ctx.tenantId}
        order by po.created_at desc`

      const r = await tx<ResultadoClaveRow[]>`
        select id, objective_id, description, target_value::text, current_value::text, unit
        from public.performance_key_results
        where tenant_id = ${ctx.tenantId}`

      const u = await tx<UnoAUnoRow[]>`
        select u.id, e.first_name || ' ' || e.last_name as employee_name,
               u.scheduled_at::text, u.status, u.notes, u.action_items
        from public.performance_one_on_ones u
        join public.employees e on e.id = u.employee_id
        where u.tenant_id = ${ctx.tenantId}
        order by u.scheduled_at desc
        limit 20`

      const ev = await tx<EvaluacionRow[]>`
        select ev.id, e.first_name || ' ' || e.last_name as employee_name, ev.cycle, ev.review_type, ev.rating
        from public.performance_reviews ev
        join public.employees e on e.id = ev.employee_id
        where ev.tenant_id = ${ctx.tenantId}
        order by ev.submitted_at desc
        limit 20`

      const p = await tx<PlanMejoraRow[]>`
        select pi.id, e.first_name || ' ' || e.last_name as employee_name, pi.reason, pi.status,
               pi.start_date::text, pi.end_date::text
        from public.performance_improvement_plans pi
        join public.employees e on e.id = pi.employee_id
        where pi.tenant_id = ${ctx.tenantId}
        order by pi.created_at desc`

      return { empleados: e, objetivos: o, resultados: r, unoAUnos: u, evaluaciones: ev, planes: p }
    },
  )

  const resultadosPorObjetivo = new Map<string, ResultadoClaveRow[]>()
  for (const r of resultados) {
    const lista = resultadosPorObjetivo.get(r.objective_id) ?? []
    lista.push(r)
    resultadosPorObjetivo.set(r.objective_id, lista)
  }

  const evaluacionesPorCiclo = new Map<string, number[]>()
  for (const e of evaluaciones) {
    const lista = evaluacionesPorCiclo.get(`${e.employee_name}·${e.cycle}`) ?? []
    lista.push(e.rating)
    evaluacionesPorCiclo.set(`${e.employee_name}·${e.cycle}`, lista)
  }

  const puedeObjetivos = exigir(ctx, 'performance', 'performance.manage-objectives').ok
  const puede1on1 = exigir(ctx, 'performance', 'performance.manage-one-on-ones').ok
  const puedeEvaluar = exigir(ctx, 'performance', 'performance.submit-review').ok
  const puedePlanes = exigir(ctx, 'performance', 'performance.manage-improvement-plans').ok
  const qs = ctx.demoQs
  const activos = planes.filter((p) => p.status === 'active').length

  return (
    <Shell {...shell} activePath="/desempeno">
      <div className="space-y-5">
        <PageHeader
          icon="trending_up"
          title="Desempeno"
          description="Objetivos, reuniones 1:1, evaluaciones y planes de mejora. El avance de cada objetivo sale de su valor actual contra la meta."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Objetivos activos"
            value={String(objetivos.filter((o) => o.status === 'active').length)}
          />
          <StatCard label="Planes de mejora activos" value={String(activos)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Objetivos (OKR)</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {objetivos.length === 0 ? (
              <EmptyState icon="flag" title="Todavia no hay ningun objetivo" description="" />
            ) : (
              objetivos.map((o) => {
                const krs = resultadosPorObjetivo.get(o.id) ?? []
                const progreso = progresoObjetivo(
                  krs.map((k) => ({
                    current: Number(k.current_value),
                    target: Number(k.target_value),
                  })),
                )
                return (
                  <div
                    key={o.id}
                    className="border-b border-[var(--color-border)] pb-3 last:border-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-[var(--color-text-primary)]">{o.title}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {o.employee_name ?? 'Toda la empresa'} · {o.period}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular text-sm font-semibold text-[var(--color-text-primary)]">
                          {progreso}%
                        </span>
                        <Badge tone={badgeTono(o.status)}>
                          {ESTADO_OBJETIVO[o.status] ?? o.status}
                        </Badge>
                      </div>
                    </div>
                    {krs.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {krs.map((k) => (
                          <li
                            key={k.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-[var(--color-text-secondary)]">
                              {k.description}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="tabular text-[var(--color-text-muted)]">
                                {k.current_value} / {k.target_value} {k.unit ?? ''}
                              </span>
                              <span className="tabular text-[var(--color-text-primary)]">
                                {progresoResultadoClave(
                                  Number(k.current_value),
                                  Number(k.target_value),
                                )}
                                %
                              </span>
                              {puedeObjetivos && (
                                <form
                                  action={actualizarProgresoForm}
                                  className="flex items-center gap-1"
                                >
                                  <input
                                    type="hidden"
                                    name="tenant"
                                    value={qs ? ctx.tenantSlug : ''}
                                  />
                                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                                  <input type="hidden" name="keyResultId" value={k.id} />
                                  <input
                                    name="currentValue"
                                    aria-label={`Valor actual de ${k.description}`}
                                    defaultValue={k.current_value}
                                    inputMode="decimal"
                                    className={`tabular w-16 ${claseInput}`}
                                  />
                                  <BotonEnvio
                                    aria-label={`Guardar progreso de ${k.description}`}
                                    className="flex h-9 items-center rounded-full border border-[var(--color-border)] px-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                                  >
                                    <Icon name="save" size={14} />
                                  </BotonEnvio>
                                </form>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {puedeObjetivos && (
                      <form
                        action={crearResultadoClaveForm}
                        className="mt-2 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="objectiveId" value={o.id} />
                        <input
                          name="description"
                          placeholder="Resultado clave"
                          required
                          className={claseInput}
                        />
                        <input
                          name="targetValue"
                          placeholder="Meta"
                          inputMode="decimal"
                          required
                          className={`tabular w-20 ${claseInput}`}
                        />
                        <input name="unit" placeholder="Unidad" className={`w-20 ${claseInput}`} />
                        <BotonEnvio className="flex h-9 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                          <Icon name="add" size={14} />
                          Agregar KR
                        </BotonEnvio>
                      </form>
                    )}
                  </div>
                )
              })
            )}

            {puedeObjetivos && (
              <form action={crearObjetivoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empleado (opcional)
                  <select name="employeeId" defaultValue="" className={claseInput}>
                    <option value="">Toda la empresa</option>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Titulo
                  <input name="title" required className={claseInput} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Periodo
                  <input name="period" placeholder="2026-Q3" required className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Nuevo objetivo
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>1:1</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {unoAUnos.length === 0 ? (
              <EmptyState icon="forum" title="Todavia no hay ningun 1:1 agendado" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Empleado</TH>
                    <TH>Fecha</TH>
                    <TH>Estado</TH>
                    <TH>Notas</TH>
                    {puede1on1 && (
                      <TH>
                        <span className="sr-only">Acción</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {unoAUnos.map((u) => (
                    <TR key={u.id}>
                      <TD className="text-[var(--color-text-primary)]">{u.employee_name}</TD>
                      <TD>
                        {new Date(u.scheduled_at).toLocaleString('es-DO', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TD>
                      <TD>
                        <Badge tone={badgeTono(u.status)}>
                          {ESTADO_1ON1[u.status] ?? u.status}
                        </Badge>
                      </TD>
                      <TD className="max-w-56 truncate">{u.notes ?? '—'}</TD>
                      {puede1on1 && (
                        <TD>
                          {u.status === 'scheduled' && (
                            <form action={completarUnoAUnoForm} className="flex items-center gap-1">
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="recordId" value={u.id} />
                              <input name="notes" placeholder="Notas" className={claseInput} />
                              <BotonEnvio className="flex h-9 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                                <Icon name="check" size={14} />
                                Cerrar
                              </BotonEnvio>
                            </form>
                          )}
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puede1on1 && empleados.length > 0 && (
              <form action={crearUnoAUnoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empleado
                  <select name="employeeId" required className={claseInput}>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha y hora
                  <input type="datetime-local" name="scheduledAt" required className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="event" size={14} />
                  Agendar 1:1
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evaluaciones (360)</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {evaluaciones.length === 0 ? (
              <EmptyState icon="star" title="Todavia no hay ninguna evaluacion" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Empleado</TH>
                    <TH>Ciclo</TH>
                    <TH>Quien evaluo</TH>
                    <TH numeric>Calificacion</TH>
                    <TH numeric>Promedio del ciclo</TH>
                  </TR>
                </THead>
                <TBody>
                  {evaluaciones.map((e) => (
                    <TR key={e.id}>
                      <TD className="text-[var(--color-text-primary)]">{e.employee_name}</TD>
                      <TD>{e.cycle}</TD>
                      <TD>{TIPO_EVALUACION[e.review_type] ?? e.review_type}</TD>
                      <TD numeric>
                        <span className="tabular">{e.rating}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular font-semibold text-[var(--color-text-primary)]">
                          {promedioEvaluacion360(
                            evaluacionesPorCiclo.get(`${e.employee_name}·${e.cycle}`) ?? [],
                          )}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeEvaluar && empleados.length > 0 && (
              <form action={enviarEvaluacionForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empleado
                  <select name="employeeId" required className={claseInput}>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Ciclo
                  <input name="cycle" placeholder="2026-Q3" required className={claseInput} />
                </label>
                <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select name="reviewType" required defaultValue="manager" className={claseInput}>
                    {Object.entries(TIPO_EVALUACION).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-20 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Calificacion (1-5)
                  <input
                    name="rating"
                    inputMode="numeric"
                    required
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Comentarios
                  <input name="comments" className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="send" size={14} />
                  Enviar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Planes de mejora</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {planes.length === 0 ? (
              <EmptyState
                icon="assignment"
                title="Todavia no hay ningun plan de mejora"
                description=""
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Empleado</TH>
                    <TH>Motivo</TH>
                    <TH>Hasta</TH>
                    <TH>Estado</TH>
                    {puedePlanes && (
                      <TH>
                        <span className="sr-only">Acción</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {planes.map((p) => (
                    <TR key={p.id}>
                      <TD className="text-[var(--color-text-primary)]">{p.employee_name}</TD>
                      <TD>{p.reason}</TD>
                      <TD>{p.end_date}</TD>
                      <TD>
                        <Badge tone={badgeTono(p.status)}>
                          {ESTADO_PLAN_MEJORA[p.status] ?? p.status}
                        </Badge>
                      </TD>
                      {puedePlanes && (
                        <TD>
                          {p.status === 'active' && (
                            <div className="flex gap-1.5">
                              <form action={resolverPlanMejoraForm}>
                                <input
                                  type="hidden"
                                  name="tenant"
                                  value={qs ? ctx.tenantSlug : ''}
                                />
                                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                                <input type="hidden" name="recordId" value={p.id} />
                                <input type="hidden" name="status" value="completed" />
                                <BotonEnvio className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-semantic-success)] px-2 text-xs font-medium text-white hover:opacity-90">
                                  Completar
                                </BotonEnvio>
                              </form>
                              <form action={resolverPlanMejoraForm}>
                                <input
                                  type="hidden"
                                  name="tenant"
                                  value={qs ? ctx.tenantSlug : ''}
                                />
                                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                                <input type="hidden" name="recordId" value={p.id} />
                                <input type="hidden" name="status" value="cancelled" />
                                <BotonEnvio className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                                  Cancelar
                                </BotonEnvio>
                              </form>
                            </div>
                          )}
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedePlanes && empleados.length > 0 && (
              <form action={crearPlanMejoraForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empleado
                  <select name="employeeId" required className={claseInput}>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Motivo
                  <input name="reason" required className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desde
                  <input type="date" name="startDate" required className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Hasta
                  <input type="date" name="endDate" required className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="send" size={14} />
                  Crear plan
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
