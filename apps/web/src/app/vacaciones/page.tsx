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
import { saldoVacaciones } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { cancelarSolicitudForm, solicitarAusenciaForm } from './actions'
import { ESTADO_SOLICITUD, TIPO_AUSENCIA } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vacaciones · REGB ERP' }

interface EmpleadoOption {
  id: string
  name: string
  hire_date: string
}

interface SolicitudRow {
  id: string
  employee_name: string
  leave_type: string
  start_date: string
  end_date: string
  business_days: number
  status: string
  reason: string | null
}

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'approved') return 'success'
  if (estado === 'pending') return 'warning'
  if (estado === 'rejected') return 'danger'
  return 'neutral'
}

const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Vacaciones & Permisos (modulo 64): saldo calculado, solicitud y aprobacion. */
export default async function VacacionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'time-off')

  const [empleados, tomadoPorEmpleado, solicitudes] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const e = await tx<EmpleadoOption[]>`
        select id, first_name || ' ' || last_name as name, hire_date::text
        from public.employees where tenant_id = ${ctx.tenantId} and status = 'active'
        order by last_name`

      const t = await tx<{ employee_id: string; dias: string }[]>`
        select employee_id, coalesce(sum(business_days), 0)::text as dias
        from public.time_off_requests
        where tenant_id = ${ctx.tenantId} and leave_type = 'vacation' and status = 'approved'
        group by employee_id`

      const s = await tx<SolicitudRow[]>`
        select r.id, e.first_name || ' ' || e.last_name as employee_name, r.leave_type,
               r.start_date::text, r.end_date::text, r.business_days, r.status, r.reason
        from public.time_off_requests r
        join public.employees e on e.id = r.employee_id
        where r.tenant_id = ${ctx.tenantId}
        order by r.created_at desc
        limit 50`

      return [e, t, s] as const
    },
  )

  const tomadoPorId = new Map(tomadoPorEmpleado.map((t) => [t.employee_id, Number(t.dias)]))
  const hoy = new Date()
  const saldos = empleados.map((e) => ({
    id: e.id,
    name: e.name,
    saldo: saldoVacaciones(new Date(`${e.hire_date}T00:00:00`), hoy, tomadoPorId.get(e.id) ?? 0),
  }))

  const pendientes = solicitudes.filter((s) => s.status === 'pending')
  const puedeSolicitar = exigir(ctx, 'time-off', 'time-off.request').ok
  const puedeAprobar = exigir(ctx, 'time-off', 'time-off.approve').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/vacaciones">
      <div className="space-y-5">
        <PageHeader
          icon="beach_access"
          title="Vacaciones & Permisos"
          description="El saldo sale de la fecha de ingreso (Código de Trabajo, art. 177): 14 días laborables por año de servicio, 18 a partir del quinto. Unas vacaciones que no caben en el saldo no se pueden pedir ni aprobar."
          actions={
            puedeAprobar && (
              <a
                href={`/vacaciones/aprobar${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="fact_check" size={18} />
                Aprobar solicitudes
              </a>
            )
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Solicitudes pendientes" value={String(pendientes.length)} />
          <StatCard label="Empleados activos" value={String(empleados.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Saldo de vacaciones</CardTitle>
          </CardHeader>
          <CardBody>
            {saldos.length === 0 ? (
              <EmptyState
                icon="beach_access"
                title="Todavia no hay empleados activos"
                description=""
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Empleado</TH>
                    <TH numeric>Días disponibles</TH>
                  </TR>
                </THead>
                <TBody>
                  {saldos.map((s) => (
                    <TR key={s.id}>
                      <TD className="text-[var(--color-text-primary)]">{s.name}</TD>
                      <TD numeric>
                        <span className="tabular">{s.saldo}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {solicitudes.length === 0 ? (
          <EmptyState
            icon="event_note"
            title="Todavia no hay ninguna solicitud"
            description="Registra la primera abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH>Tipo</TH>
                <TH>Desde</TH>
                <TH>Hasta</TH>
                <TH numeric>Días</TH>
                <TH>Estado</TH>
                {puedeSolicitar && (
                  <TH>
                    <span className="sr-only">Acción</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {solicitudes.map((s) => (
                <TR key={s.id}>
                  <TD className="text-[var(--color-text-primary)]">{s.employee_name}</TD>
                  <TD>{TIPO_AUSENCIA[s.leave_type] ?? s.leave_type}</TD>
                  <TD>{fechaCorta(s.start_date)}</TD>
                  <TD>{fechaCorta(s.end_date)}</TD>
                  <TD numeric>
                    <span className="tabular">{s.business_days}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeTono(s.status)}>
                      {ESTADO_SOLICITUD[s.status] ?? s.status}
                    </Badge>
                  </TD>
                  {puedeSolicitar && (
                    <TD>
                      {s.status === 'pending' && (
                        <form action={cancelarSolicitudForm}>
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="recordId" value={s.id} />
                          <BotonEnvio className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                            <Icon name="cancel" size={14} />
                            Cancelar
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

        {puedeSolicitar && empleados.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva solicitud</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={solicitarAusenciaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empleado
                  <select name="employeeId" required className={claseInput}>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select name="leaveType" required defaultValue="vacation" className={claseInput}>
                    {Object.entries(TIPO_AUSENCIA).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desde
                  <input type="date" name="startDate" required className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Hasta
                  <input type="date" name="endDate" required className={claseInput} />
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Motivo (opcional)
                  <input name="reason" className={claseInput} />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="send" size={18} />
                  Solicitar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
