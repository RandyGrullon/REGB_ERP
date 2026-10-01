import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import {
  hitoVigente,
  puedeAvanzarPorDependencias,
  type EstadoProyecto,
  type EstadoTarea,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  agregarDependenciaForm,
  completarHitoForm,
  crearHitoForm,
  crearTareaForm,
  transicionarProyectoForm,
  transicionarTareaForm,
} from '../actions'
import { ESTADO_PROYECTO, ESTADO_TAREA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'
import { fechaCorta, hoyRD, yaVencio } from '@/lib/fechas-rd'

export const dynamic = 'force-dynamic'

interface ProyectoHead {
  id: string
  name: string
  description: string | null
  status: EstadoProyecto
  start_date: string | null
  end_date: string | null
}

interface Tarea {
  id: string
  name: string
  status: EstadoTarea
  due_date: string | null
  responsable: string | null
  dependencias: string[]
  estados_dependencias: EstadoTarea[]
}

interface Hito {
  id: string
  name: string
  due_date: string
  completed_at: string | null
}

const COLUMNAS: EstadoTarea[] = ['todo', 'in_progress', 'blocked', 'done']
const SIGUIENTE: Partial<Record<EstadoTarea, EstadoTarea>> = {
  todo: 'in_progress',
  in_progress: 'done',
  blocked: 'todo',
}
const ACCION_SIGUIENTE: Partial<Record<EstadoTarea, string>> = {
  todo: 'Empezar',
  in_progress: 'Marcar hecha',
  blocked: 'Desbloquear',
}
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'active') return 'success'
  if (s === 'cancelled') return 'danger'
  if (s === 'on_hold') return 'warning'
  return 'neutral'
}

/** Detalle de un proyecto (modulo 71): su tablero real y sus dependencias que de verdad bloquean. */
export default async function ProyectoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'projects')

  const { head, tareas, hitos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<ProyectoHead[]>`
      select id, name, description, status, start_date::text, end_date::text
      from public.projects where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, tareas: [], hitos: [] }

    const t = await tx<Tarea[]>`
      select pt.id, pt.name, pt.status, pt.due_date::text,
             up.display_name as responsable,
             coalesce(
               (select array_agg(dt.name order by dt.position, dt.created_at)
                from public.task_dependencies td
                join public.project_tasks dt on dt.id = td.depends_on_task_id
                where td.task_id = pt.id),
               '{}'
             ) as dependencias,
             coalesce(
               (select array_agg(dt.status order by dt.position, dt.created_at)
                from public.task_dependencies td
                join public.project_tasks dt on dt.id = td.depends_on_task_id
                where td.task_id = pt.id),
               '{}'
             ) as estados_dependencias
      from public.project_tasks pt
      left join public.user_profiles up
        on up.tenant_id = pt.tenant_id and up.user_id = pt.assigned_to
      where pt.tenant_id = ${ctx.tenantId} and pt.project_id = ${id}
      order by pt.position, pt.created_at`

    const m = await tx<Hito[]>`
      select id, name, due_date::text, completed_at::text
      from public.project_milestones where tenant_id = ${ctx.tenantId} and project_id = ${id}
      order by due_date`

    return { head: h, tareas: t, hitos: m }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'projects', 'projects.manage').ok
  const qs = ctx.demoQs
  const hechas = tareas.filter((t) => t.status === 'done').length
  const avance = tareas.length === 0 ? 0 : Math.round((hechas / tareas.length) * 100)
  const vencidas = tareas.filter(
    (t) => t.status !== 'done' && t.due_date && yaVencio(t.due_date),
  ).length
  const hitosHechos = hitos.filter((h) => h.completed_at).length
  const abierto =
    head.status === 'planning' || head.status === 'active' || head.status === 'on_hold'
  const atrasado = abierto && !!head.end_date && yaVencio(head.end_date)
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="projectId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/proyectos">
      <div className="space-y-5">
        <PageHeader
          icon="view_kanban"
          title={head.name}
          description={head.description ?? undefined}
          crumbs={[{ label: 'Proyectos y tareas', href: `/proyectos${qs}` }, { label: head.name }]}
          actions={
            <Badge tone={badgeEstado(head.status)}>
              {ESTADO_PROYECTO[head.status] ?? head.status}
            </Badge>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Avance"
            value={`${avance}%`}
            hint={`${hechas} de ${tareas.length} tareas hechas`}
          />
          <StatCard
            label="Tareas vencidas"
            value={String(vencidas)}
            hint={vencidas > 0 ? 'pasaron su fecha sin terminar' : 'todo va a tiempo'}
          />
          <StatCard
            label="Termina"
            value={head.end_date ? fechaCorta(head.end_date, true) : 'Sin fecha'}
            hint={
              atrasado
                ? 'ya pasó la fecha de fin'
                : head.start_date
                  ? `${head.start_date.slice(0, 10) > hoyRD() ? 'empieza' : 'empezó'} el ${fechaCorta(head.start_date, true)}`
                  : 'sin fecha de inicio'
            }
          />
          <StatCard label="Hitos cumplidos" value={`${hitosHechos} de ${hitos.length}`} />
        </section>

        {puedeGestionar && (
          <div className="flex flex-wrap gap-2">
            {head.status === 'planning' && (
              <form action={transicionarProyectoForm}>
                {campos}
                <input type="hidden" name="siguiente" value="active" />
                <BotonEnvio className={botonClase}>
                  <Icon name="play_arrow" size={14} />
                  Activar
                </BotonEnvio>
              </form>
            )}
            {head.status === 'active' && (
              <>
                <form action={transicionarProyectoForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="on_hold" />
                  <BotonEnvio className={botonSecundarioClase}>Pausar</BotonEnvio>
                </form>
                <form action={transicionarProyectoForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="completed" />
                  <BotonEnvio className={botonClase}>
                    <Icon name="check_circle" size={14} />
                    Completar
                  </BotonEnvio>
                </form>
              </>
            )}
            {head.status === 'on_hold' && (
              <form action={transicionarProyectoForm}>
                {campos}
                <input type="hidden" name="siguiente" value="active" />
                <BotonEnvio className={botonClase}>Reanudar</BotonEnvio>
              </form>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNAS.map((col) => {
            const deLaColumna = tareas.filter((t) => t.status === col)
            return (
              <section key={col} aria-label={ESTADO_TAREA[col]} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                  {ESTADO_TAREA[col]} ({deLaColumna.length})
                </h2>
                <div className="space-y-2">
                  {deLaColumna.length === 0 && (
                    <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
                      Ninguna tarea aquí.
                    </p>
                  )}
                  {deLaColumna.map((t) => {
                    const siguiente = SIGUIENTE[t.status]
                    const pendientes = t.dependencias.filter(
                      (_, i) => t.estados_dependencias[i] !== 'done',
                    )
                    const bloqueadaPorDependencias =
                      !!siguiente && !puedeAvanzarPorDependencias(t.estados_dependencias, siguiente)
                    const vencida = t.status !== 'done' && !!t.due_date && yaVencio(t.due_date)
                    return (
                      <div
                        key={t.id}
                        className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3"
                      >
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {t.name}
                        </p>
                        {t.due_date && (
                          <p
                            className={`flex items-center gap-1 text-xs ${vencida ? 'font-semibold text-[var(--color-semantic-text-danger)]' : 'text-[var(--color-text-muted)]'}`}
                          >
                            {vencida && <Icon name="schedule" size={14} />}
                            {vencida ? 'Venció el' : 'Vence el'} {fechaCorta(t.due_date)}
                          </p>
                        )}
                        {t.responsable && (
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            A cargo de {t.responsable}
                          </p>
                        )}
                        {t.dependencias.length > 0 && (
                          <p className="text-xs text-[var(--color-text-muted)]">
                            Depende de: {t.dependencias.join(', ')}
                          </p>
                        )}
                        {puedeGestionar && siguiente && bloqueadaPorDependencias && (
                          <p className="flex items-start gap-1 text-xs text-[var(--color-semantic-text-warning)]">
                            <Icon name="lock" size={14} />
                            Arranca cuando esté hecha: {pendientes.join(', ')}
                          </p>
                        )}
                        {puedeGestionar && siguiente && !bloqueadaPorDependencias && (
                          <form action={transicionarTareaForm}>
                            {campos}
                            <input type="hidden" name="taskId" value={t.id} />
                            <input type="hidden" name="siguiente" value={siguiente} />
                            <BotonEnvio className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-3 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                              <Icon name="arrow_forward" size={14} />
                              {ACCION_SIGUIENTE[t.status]}
                            </BotonEnvio>
                          </form>
                        )}
                        {puedeGestionar && t.status !== 'done' && tareas.length > 1 && (
                          <form action={agregarDependenciaForm} className="flex items-center gap-1">
                            {campos}
                            <input type="hidden" name="taskId" value={t.id} />
                            <select
                              name="dependsOnTaskId"
                              required
                              defaultValue=""
                              aria-label={`Tarea de la que depende «${t.name}»`}
                              className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-1 text-xs text-[var(--color-text-primary)]"
                            >
                              <option value="" disabled>
                                Depende de…
                              </option>
                              {tareas
                                .filter((o) => o.id !== t.id && !t.dependencias.includes(o.name))
                                .map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                            </select>
                            <BotonEnvio className="flex h-8 items-center rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                              Agregar
                            </BotonEnvio>
                          </form>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva tarea</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearTareaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vence
                  <input
                    type="date"
                    name="dueDate"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className={botonClase}>
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Hitos</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2">
              {hitos.length === 0 && (
                <li className="text-xs text-[var(--color-text-muted)]">
                  Todavía no hay ningún hito.
                </li>
              )}
              {hitos.map((h) => {
                const vencido =
                  !h.completed_at &&
                  !hitoVigente(new Date(`${h.due_date.slice(0, 10)}T12:00:00`), new Date())
                return (
                  <li
                    key={h.id}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5"
                  >
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)]">{h.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {fechaCorta(h.due_date, true)}
                      </p>
                    </div>
                    {h.completed_at ? (
                      <Badge tone="success">Completado</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Badge tone={vencido ? 'danger' : 'warning'}>
                          {vencido ? 'Vencido' : 'Pendiente'}
                        </Badge>
                        {puedeGestionar && (
                          <form action={completarHitoForm}>
                            {campos}
                            <input type="hidden" name="milestoneId" value={h.id} />
                            <BotonEnvio className="flex h-8 items-center rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                              Completar
                            </BotonEnvio>
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>

            {puedeGestionar && (
              <form action={crearHitoForm} className="mt-4 flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input
                    type="date"
                    name="dueDate"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className={botonSecundarioClase}>
                  <Icon name="add" size={14} />
                  Agregar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
