import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import { hitoVigente, type EstadoProyecto, type EstadoTarea } from '@regb/operations'
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
  dependencias: string[]
}

interface Hito {
  id: string
  name: string
  due_date: string
  completed_at: string | null
}

const COLUMNAS: EstadoTarea[] = ['todo', 'in_progress', 'blocked', 'done']
const SIGUIENTE: Partial<Record<EstadoTarea, EstadoTarea>> = { todo: 'in_progress', in_progress: 'done', blocked: 'todo' }
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
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
             coalesce(
               (select array_agg(dt.name) from public.task_dependencies td
                join public.project_tasks dt on dt.id = td.depends_on_task_id
                where td.task_id = pt.id),
               '{}'
             ) as dependencias
      from public.project_tasks pt
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
          crumbs={[{ label: 'Proyectos & Tareas', href: `/proyectos${qs}` }, { label: head.name }]}
          actions={<Badge tone={badgeEstado(head.status)}>{ESTADO_PROYECTO[head.status] ?? head.status}</Badge>}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Tareas" value={String(tareas.length)} />
          <StatCard label="Hitos" value={String(hitos.length)} />
        </section>

        {puedeGestionar && (
          <div className="flex flex-wrap gap-2">
            {head.status === 'planning' && (
              <form action={transicionarProyectoForm}>
                {campos}
                <input type="hidden" name="siguiente" value="active" />
                <BotonEnvio  className={botonClase}>
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
                  <BotonEnvio  className={botonSecundarioClase}>
                    Pausar
                  </BotonEnvio>
                </form>
                <form action={transicionarProyectoForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="completed" />
                  <BotonEnvio  className={botonClase}>
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
                <BotonEnvio  className={botonClase}>
                  Reanudar
                </BotonEnvio>
              </form>
            )}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-4">
          {COLUMNAS.map((col) => (
            <div key={col} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                {ESTADO_TAREA[col]} ({tareas.filter((t) => t.status === col).length})
              </h2>
              <div className="space-y-2">
                {tareas
                  .filter((t) => t.status === col)
                  .map((t) => (
                    <div key={t.id} className="space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">{t.name}</p>
                      {t.due_date && <p className="text-xs text-[var(--color-text-muted)]">Vence {new Date(t.due_date).toLocaleDateString('es-DO')}</p>}
                      {t.dependencias.length > 0 && (
                        <p className="text-xs text-[var(--color-text-muted)]">Depende de: {t.dependencias.join(', ')}</p>
                      )}
                      {puedeGestionar && SIGUIENTE[t.status] && (
                        <form action={transicionarTareaForm}>
                          {campos}
                          <input type="hidden" name="taskId" value={t.id} />
                          <input type="hidden" name="siguiente" value={SIGUIENTE[t.status]} />
                          <BotonEnvio
                            
                            className="flex h-7 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                            <Icon name="arrow_forward" size={12} />
                            {ESTADO_TAREA[SIGUIENTE[t.status]!]}
                          </BotonEnvio>
                        </form>
                      )}
                      {puedeGestionar && tareas.length > 1 && (
                        <form action={agregarDependenciaForm} className="flex items-center gap-1">
                          {campos}
                          <input type="hidden" name="taskId" value={t.id} />
                          <select
                            name="dependsOnTaskId"
                            className="h-7 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-1 text-xs text-[var(--color-text-primary)]"
                          >
                            {tareas.filter((o) => o.id !== t.id).map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                          <BotonEnvio  className="flex h-7 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                            +Dep.
                          </BotonEnvio>
                        </form>
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
              <CardTitle>Nueva tarea</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearTareaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="name" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vence
                  <input type="date" name="dueDate" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <BotonEnvio  className={botonClase}>
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
              {hitos.length === 0 && <li className="text-xs text-[var(--color-text-muted)]">Todavia no hay ningun hito.</li>}
              {hitos.map((h) => {
                const vencido = !h.completed_at && !hitoVigente(new Date(h.due_date), new Date())
                return (
                  <li key={h.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5">
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)]">{h.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {new Date(h.due_date).toLocaleDateString('es-DO')}
                      </p>
                    </div>
                    {h.completed_at ? (
                      <Badge tone="success">Completado</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Badge tone={vencido ? 'danger' : 'warning'}>{vencido ? 'Vencido' : 'Pendiente'}</Badge>
                        {puedeGestionar && (
                          <form action={completarHitoForm}>
                            {campos}
                            <input type="hidden" name="milestoneId" value={h.id} />
                            <BotonEnvio  className="flex h-7 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
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
                  <input name="name" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input type="date" name="dueDate" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <BotonEnvio  className={botonSecundarioClase}>
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
