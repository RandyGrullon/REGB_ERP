import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, Icon, PageHeader, StatCard, TBody, TD, TH, THead, TR, Table } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearProyectoForm } from './actions'
import { ESTADO_PROYECTO } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Proyectos & Tareas · REGB ERP' }

interface ProyectoFila {
  id: string
  name: string
  status: string
  end_date: string | null
  tareas: string
}

const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'active') return 'success'
  if (s === 'cancelled') return 'danger'
  if (s === 'on_hold') return 'warning'
  if (s === 'completed') return 'neutral'
  return 'neutral'
}

/** Proyectos & Tareas (modulo 71): una tarea no avanza con dependencias abiertas -lo exige un trigger-. */
export default async function ProyectosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'projects')

  const proyectos = await asUser(ctx.userId, ctx.tenantId, (tx) => tx<ProyectoFila[]>`
    select p.id, p.name, p.status, p.end_date::text,
           (select count(*)::text from public.project_tasks where project_id = p.id) as tareas
    from public.projects p
    where p.tenant_id = ${ctx.tenantId}
    order by p.created_at desc`)

  const activos = proyectos.filter((p) => p.status === 'active').length
  const puedeGestionar = exigir(ctx, 'projects', 'projects.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/proyectos">
      <div className="space-y-5">
        <PageHeader
          icon="view_kanban"
          title="Proyectos & Tareas"
          description="Una tarea no puede avanzar con dependencias abiertas -lo exige un trigger de base de datos, no solo la pantalla-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Proyectos" value={String(proyectos.length)} />
          <StatCard label="Activos" value={String(activos)} />
        </section>

        {proyectos.length === 0 ? (
          <EmptyState icon="view_kanban" title="Todavia no hay ningun proyecto" description="Crea el primero abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Proyecto</TH>
                <TH numeric>Tareas</TH>
                <TH>Vence</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {proyectos.map((p) => (
                <TR key={p.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/proyectos/${p.id}${qs}`} className="underline-offset-2 hover:underline">
                      {p.name}
                    </a>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{p.tareas}</span>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">
                    {p.end_date ? new Date(p.end_date).toLocaleDateString('es-DO') : 'Sin fecha'}
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(p.status)}>{ESTADO_PROYECTO[p.status] ?? p.status}</Badge>
                  </TD>
                </TR>
              ))}
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
                  <input type="date" name="startDate" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fin
                  <input type="date" name="endDate" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="add" size={14} />
                  Crear
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
