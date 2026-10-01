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
import { crearProyectoForm } from './actions'
import { ESTADO_PROYECTO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'
import { fechaCorta, yaVencio } from '@/lib/fechas-rd'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Proyectos y tareas · REGB ERP' }

interface ProyectoFila {
  id: string
  name: string
  status: string
  start_date: string | null
  end_date: string | null
  tareas: string
  hechas: string
}

const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'active') return 'success'
  if (s === 'cancelled') return 'danger'
  if (s === 'on_hold') return 'warning'
  if (s === 'completed') return 'neutral'
  return 'neutral'
}

/** Proyectos y tareas (modulo 71): una tarea no avanza con dependencias abiertas (lo exige un trigger). */
export default async function ProyectosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'projects')

  const proyectos = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<ProyectoFila[]>`
    select p.id, p.name, p.status, p.start_date::text, p.end_date::text,
           (select count(*)::text from public.project_tasks where project_id = p.id) as tareas,
           (select count(*)::text from public.project_tasks
             where project_id = p.id and status = 'done') as hechas
    from public.projects p
    where p.tenant_id = ${ctx.tenantId}
    order by p.created_at desc`,
  )

  const activos = proyectos.filter((p) => p.status === 'active').length
  const abierto = (s: string) => s === 'planning' || s === 'active' || s === 'on_hold'
  const atrasados = proyectos.filter(
    (p) => abierto(p.status) && p.end_date && yaVencio(p.end_date),
  ).length
  const puedeGestionar = exigir(ctx, 'projects', 'projects.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/proyectos">
      <div className="space-y-5">
        <PageHeader
          icon="view_kanban"
          title="Proyectos y tareas"
          description="Cada proyecto con sus tareas, sus fechas y cuánto le falta. Una tarea no arranca mientras la que la precede no esté hecha."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Proyectos" value={String(proyectos.length)} />
          <StatCard label="Activos" value={String(activos)} />
          <StatCard
            label="Atrasados"
            value={String(atrasados)}
            hint={atrasados > 0 ? 'ya pasó su fecha de fin' : 'ninguno pasó su fecha de fin'}
          />
        </section>

        {proyectos.length === 0 ? (
          <EmptyState
            icon="view_kanban"
            title="Todavía no hay ningún proyecto"
            description="Un proyecto agrupa tareas con fecha, dependencias e hitos. Crea el primero abajo; después le agregas las tareas desde su tablero."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Proyecto</TH>
                <TH numeric>Avance</TH>
                <TH>Fechas</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {proyectos.map((p) => {
                const total = Number(p.tareas)
                const hechas = Number(p.hechas)
                const atrasado = abierto(p.status) && !!p.end_date && yaVencio(p.end_date)
                return (
                  <TR key={p.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <a
                        href={`/proyectos/${p.id}${qs}`}
                        className="font-semibold text-[var(--color-text-link)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {p.name}
                      </a>
                    </TD>
                    <TD numeric>
                      <span className="tabular whitespace-nowrap">
                        {total === 0 ? 'Sin tareas' : `${hechas} de ${total} hechas`}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-[var(--color-text-secondary)]">
                      {p.start_date ? fechaCorta(p.start_date) : 'Sin inicio'} –{' '}
                      {p.end_date ? fechaCorta(p.end_date, true) : 'sin fecha de fin'}
                      {atrasado && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-semantic-text-danger)]">
                          <Icon name="schedule" size={14} />
                          Atrasado
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={badgeEstado(p.status)}>
                        {ESTADO_PROYECTO[p.status] ?? p.status}
                      </Badge>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo proyecto</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearProyectoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Inicio
                  <input
                    type="date"
                    name="startDate"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fin
                  <input
                    type="date"
                    name="endDate"
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
      </div>
    </Shell>
  )
}
