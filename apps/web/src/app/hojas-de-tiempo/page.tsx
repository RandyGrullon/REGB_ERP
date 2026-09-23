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
import { montoFacturable } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearRegistroForm, transicionarRegistroForm } from './actions'
import { ESTADO_REGISTRO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Hojas de tiempo · REGB ERP' }

interface RegistroFila {
  id: string
  task_name: string
  project_name: string
  entry_date: string
  hours: string
  billable: boolean
  hourly_rate: string
  status: string
}

interface TareaOption {
  id: string
  name: string
  project_name: string
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'approved') return 'success'
  if (s === 'rejected') return 'danger'
  if (s === 'submitted') return 'warning'
  return 'neutral'
}

/** Hojas de tiempo (modulo 72): rechazado se corrige y se reenvia; aprobado es terminal de verdad. */
export default async function HojasDeTiempoPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'timesheets')

  const { registros, tareas } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const r = await tx<RegistroFila[]>`
      select te.id, pt.name as task_name, p.name as project_name, te.entry_date::text,
             te.hours::text, te.billable, te.hourly_rate::text, te.status
      from public.time_entries te
      join public.project_tasks pt on pt.id = te.task_id
      join public.projects p on p.id = pt.project_id
      where te.tenant_id = ${ctx.tenantId}
      order by te.entry_date desc`
    const t = await tx<TareaOption[]>`
      select pt.id, pt.name, p.name as project_name
      from public.project_tasks pt
      join public.projects p on p.id = pt.project_id
      where pt.tenant_id = ${ctx.tenantId}
      order by p.name, pt.name limit 300`
    return { registros: r, tareas: t }
  })

  const porAprobar = registros.filter((r) => r.status === 'submitted').length
  const totalFacturable = registros
    .filter((r) => r.status === 'approved')
    .reduce((acc, r) => acc + montoFacturable(Number(r.hours), Number(r.hourly_rate), r.billable), 0)
  const puedeGestionar = exigir(ctx, 'timesheets', 'timesheets.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/hojas-de-tiempo">
      <div className="space-y-5">
        <PageHeader
          icon="timer"
          title="Hojas de tiempo"
          description="Rechazado se corrige y se reenvia. Solo aprobado es terminal de verdad."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Por aprobar" value={String(porAprobar)} />
          <StatCard label="Facturable aprobado" value={`RD$ ${money(totalFacturable)}`} />
        </section>

        {registros.length === 0 ? (
          <EmptyState icon="timer" title="Todavia no hay ningun registro" description="Crea el primero abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Tarea</TH>
                <TH>Proyecto</TH>
                <TH>Fecha</TH>
                <TH numeric>Horas</TH>
                <TH>Estado</TH>
                <TH>
                  <span className="sr-only">Accion</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {registros.map((r) => (
                <TR key={r.id}>
                  <TD className="text-[var(--color-text-primary)]">{r.task_name}</TD>
                  <TD className="text-[var(--color-text-muted)]">{r.project_name}</TD>
                  <TD className="text-[var(--color-text-muted)]">{new Date(r.entry_date).toLocaleDateString('es-DO')}</TD>
                  <TD numeric>
                    <span className="tabular">{r.hours}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(r.status)}>{ESTADO_REGISTRO[r.status] ?? r.status}</Badge>
                  </TD>
                  <TD>
                    {puedeGestionar && (
                      <div className="flex gap-2">
                        {r.status === 'draft' && (
                          <form action={transicionarRegistroForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="entryId" value={r.id} />
                            <input type="hidden" name="siguiente" value="submitted" />
                            <BotonEnvio  className="flex h-7 items-center rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                              Enviar
                            </BotonEnvio>
                          </form>
                        )}
                        {r.status === 'submitted' && (
                          <>
                            <form action={transicionarRegistroForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="entryId" value={r.id} />
                              <input type="hidden" name="siguiente" value="approved" />
                              <BotonEnvio  className="flex h-7 items-center rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                                Aprobar
                              </BotonEnvio>
                            </form>
                            <form action={transicionarRegistroForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="entryId" value={r.id} />
                              <input type="hidden" name="siguiente" value="rejected" />
                              <BotonEnvio  className="flex h-7 items-center rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                                Rechazar
                              </BotonEnvio>
                            </form>
                          </>
                        )}
                        {r.status === 'rejected' && (
                          <form action={transicionarRegistroForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="entryId" value={r.id} />
                            <input type="hidden" name="siguiente" value="draft" />
                            <BotonEnvio  className="flex h-7 items-center rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                              Corregir
                            </BotonEnvio>
                          </form>
                        )}
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo registro</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearRegistroForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tarea
                  <select
                    name="taskId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {tareas.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.project_name} · {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input type="date" name="entryDate" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Horas
                  <input name="hours" required inputMode="decimal" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular" />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tarifa/hora
                  <input name="hourlyRate" inputMode="decimal" defaultValue="0" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular" />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                  <input type="checkbox" name="billable" defaultChecked />
                  Facturable
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
