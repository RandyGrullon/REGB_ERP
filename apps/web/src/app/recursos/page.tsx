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
import { capacidadDisponible, estaSobrecargado, porcentajeUtilizacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { asignarForm, fijarCapacidadForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { fechaCorta, horasCortas } from '@/lib/fechas-rd'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Planificación de recursos · REGB ERP' }

interface FilaSemana {
  user_id: string
  display_name: string | null
  week_start: string
  capacidad: string
  asignadas: string
}

interface Asignacion {
  id: string
  display_name: string | null
  task_name: string
  project_name: string
  week_start: string
  hours: string
}

interface UsuarioOption {
  user_id: string
  display_name: string
}

interface TareaOption {
  id: string
  name: string
  project_name: string
}

const inputClase =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(0)}%`)

/** Planificación de recursos (modulo 75): la sobrecarga se deriva, nunca se guarda como bandera. */
export default async function RecursosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'resources')

  const { semanas, asignaciones, usuarios, tareas } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const s = await tx<FilaSemana[]>`
      select rc.user_id, up.display_name, rc.week_start::text,
             rc.hours_capacity::text as capacidad,
             public.resource_allocated_hours(${ctx.tenantId}, rc.user_id, rc.week_start)::text as asignadas
      from public.resource_capacity rc
      left join public.user_profiles up on up.tenant_id = ${ctx.tenantId} and up.user_id = rc.user_id
      where rc.tenant_id = ${ctx.tenantId}
      order by rc.week_start desc, up.display_name`

      const a = await tx<Asignacion[]>`
      select ra.id, up.display_name, pt.name as task_name, p.name as project_name,
             ra.week_start::text, ra.hours::text
      from public.resource_allocations ra
      join public.project_tasks pt on pt.id = ra.task_id
      join public.projects p on p.id = pt.project_id
      left join public.user_profiles up on up.tenant_id = ${ctx.tenantId} and up.user_id = ra.user_id
      where ra.tenant_id = ${ctx.tenantId}
      order by ra.week_start desc, p.name`

      const u = await tx<UsuarioOption[]>`
      select user_id, display_name from public.user_profiles where tenant_id = ${ctx.tenantId} order by display_name`

      const t = await tx<TareaOption[]>`
      select pt.id, pt.name, p.name as project_name
      from public.project_tasks pt
      join public.projects p on p.id = pt.project_id
      where pt.tenant_id = ${ctx.tenantId}
      order by p.name, pt.name limit 300`

      return { semanas: s, asignaciones: a, usuarios: u, tareas: t }
    },
  )

  const sobrecargados = semanas.filter((s) =>
    estaSobrecargado(Number(s.capacidad), Number(s.asignadas)),
  ).length
  const puedeGestionar = exigir(ctx, 'resources', 'resources.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

  return (
    <Shell {...shell} activePath="/recursos">
      <div className="space-y-5">
        <PageHeader
          icon="calendar_month"
          title="Planificación de recursos"
          description="Cuántas horas tiene cada persona por semana y cuántas ya le asignaste en tareas de proyectos. Una semana llena está bien; pasarse de su capacidad es sobrecarga."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Semanas planificadas" value={String(semanas.length)} />
          <StatCard
            label="Semanas con sobrecarga"
            value={String(sobrecargados)}
            hint={
              sobrecargados > 0
                ? 'alguien tiene más horas que su capacidad'
                : 'nadie pasa de su capacidad'
            }
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Capacidad por semana</CardTitle>
          </CardHeader>
          <CardBody>
            {semanas.length === 0 ? (
              <EmptyState
                icon="calendar_month"
                title="Todavía no hay capacidad fijada"
                description="Primero dile al sistema cuántas horas tiene cada persona esa semana (40 es lo normal). Después, asígnale tareas y verás si se pasa."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Persona</TH>
                    <TH>Semana</TH>
                    <TH numeric>Capacidad</TH>
                    <TH numeric>Asignadas</TH>
                    <TH numeric>Disponible</TH>
                    <TH>Utilización</TH>
                  </TR>
                </THead>
                <TBody>
                  {semanas.map((s) => {
                    const cap = Number(s.capacidad)
                    const asig = Number(s.asignadas)
                    const sobre = estaSobrecargado(cap, asig)
                    return (
                      <TR key={`${s.user_id}-${s.week_start}`}>
                        <TD className="text-[var(--color-text-primary)]">
                          {s.display_name ?? 'Usuario'}
                        </TD>
                        <TD className="whitespace-nowrap text-[var(--color-text-muted)]">
                          Del {fechaCorta(s.week_start, true)}
                        </TD>
                        <TD numeric>
                          <span className="tabular">{horasCortas(cap)} h</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular">{horasCortas(asig)} h</span>
                        </TD>
                        <TD numeric>
                          <span
                            className={`tabular ${sobre ? 'font-semibold text-[var(--color-semantic-text-danger)]' : ''}`}
                          >
                            {sobre
                              ? `${horasCortas(asig - cap)} h de más`
                              : `${horasCortas(capacidadDisponible(cap, asig))} h`}
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={sobre ? 'danger' : 'success'}>
                            {sobre
                              ? `Sobrecargado (${pct(porcentajeUtilizacion(asig, cap))})`
                              : pct(porcentajeUtilizacion(asig, cap))}
                          </Badge>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}

            {puedeGestionar && (
              <form action={fijarCapacidadForm} className="mt-4 flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Persona
                  <select name="userId" required className={inputClase}>
                    {usuarios.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Semana (cualquier día)
                  <input type="date" name="weekStart" required className={inputClase} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Horas
                  <input
                    name="hoursCapacity"
                    required
                    inputMode="decimal"
                    defaultValue="40"
                    className={`${inputClase} tabular`}
                  />
                </label>
                <BotonEnvio className={botonClase}>
                  <Icon name="add" size={14} />
                  Fijar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Asignaciones</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-[var(--color-border)]">
              {asignaciones.length === 0 && (
                <li className="py-2 text-xs text-[var(--color-text-muted)]">
                  Todavía no hay asignaciones. Elige una tarea, una persona y la semana abajo.
                </li>
              )}
              {asignaciones.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm text-[var(--color-text-primary)]">
                      {a.display_name ?? 'Usuario'} · {a.task_name}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {a.project_name} · semana del {fechaCorta(a.week_start, true)}
                    </p>
                  </div>
                  <span className="tabular whitespace-nowrap text-sm text-[var(--color-text-primary)]">
                    {horasCortas(Number(a.hours))} h
                  </span>
                </li>
              ))}
            </ul>

            {puedeGestionar && tareas.length > 0 && (
              <form action={asignarForm} className="mt-4 flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tarea
                  <select name="taskId" required className={inputClase}>
                    {tareas.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.project_name} · {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Persona
                  <select name="userId" required className={inputClase}>
                    {usuarios.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Semana (cualquier día)
                  <input type="date" name="weekStart" required className={inputClase} />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Horas
                  <input
                    name="hours"
                    required
                    inputMode="decimal"
                    className={`${inputClase} tabular`}
                  />
                </label>
                <BotonEnvio className={botonClase}>
                  <Icon name="add" size={14} />
                  Asignar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
