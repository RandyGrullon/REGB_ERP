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
import { esAnuncioVigente, saldoVacaciones } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { editarMiTelefonoForm, solicitarDesdePortalForm } from './actions'
import { resolverMiEmpleado } from './mi-empleado'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi portal · REGB ERP' }

interface VolanteRow {
  period_start: string
  period_end: string
  pay_date: string
  gross_salary: string
  tss_deduction: string
  income_tax: string
  net_salary: string
}

interface SolicitudRow {
  id: string
  start_date: string
  end_date: string
  business_days: number
  status: string
}

interface AnuncioRow {
  id: string
  title: string
  body: string
  published_at: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

const ESTADO_SOLICITUD: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
}

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'approved') return 'success'
  if (estado === 'pending') return 'warning'
  if (estado === 'rejected') return 'danger'
  return 'neutral'
}

/** Portal del Empleado (modulo 70): tu expediente, tu volante, tu saldo, los anuncios. */
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'hr-portal')

  const { yo, volantes, solicitudes, tomado, anuncios } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const yo = await resolverMiEmpleado(tx, ctx.tenantId, ctx.userId)

      const an = await tx<AnuncioRow[]>`
        select id, title, body, published_at::text from public.hr_announcements
        where tenant_id = ${ctx.tenantId} order by published_at desc limit 10`

      if (!yo) return { yo: null, volantes: [], solicitudes: [], tomado: 0, anuncios: an }

      const v = await tx<VolanteRow[]>`
        select pp.period_start::text, pp.period_end::text, pp.pay_date::text,
               pl.gross_salary::text, pl.tss_deduction::text, pl.income_tax::text, pl.net_salary::text
        from public.payroll_lines pl
        join public.payroll_periods pp on pp.id = pl.period_id
        where pl.tenant_id = ${ctx.tenantId} and pl.employee_id = ${yo.id} and pp.status <> 'draft'
        order by pp.period_end desc
        limit 12`

      const s = await tx<SolicitudRow[]>`
        select id, start_date::text, end_date::text, business_days, status
        from public.time_off_requests
        where tenant_id = ${ctx.tenantId} and employee_id = ${yo.id}
        order by start_date desc
        limit 12`

      const [t] = await tx<{ dias: string }[]>`
        select coalesce(sum(business_days), 0)::text as dias from public.time_off_requests
        where tenant_id = ${ctx.tenantId} and employee_id = ${yo.id}
          and leave_type = 'vacation' and status = 'approved'`

      return { yo, volantes: v, solicitudes: s, tomado: Number(t?.dias ?? 0), anuncios: an }
    },
  )

  const puedeEditar = exigir(ctx, 'hr-portal', 'hr-portal.edit-profile').ok
  const puedeSolicitar = exigir(ctx, 'hr-portal', 'hr-portal.request-time-off').ok
  const qs = ctx.demoQs
  const hoy = new Date()

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  const saldo = yo ? saldoVacaciones(new Date(`${yo.hire_date}T00:00:00`), hoy, tomado) : 0

  return (
    <Shell {...shell} activePath="/portal">
      <div className="space-y-5">
        <PageHeader
          icon="badge"
          title="Mi portal"
          description="Tu expediente, tu volante y tu saldo de vacaciones -los mismos numeros que ya calculan payroll y time-off, nunca recalculados aqui-."
        />

        {!yo ? (
          <EmptyState
            icon="badge"
            title="No encontramos tu expediente"
            description="El correo de tu cuenta no coincide con el de ningun expediente activo. Pide a RRHH que verifique el correo en tu expediente."
          />
        ) : (
          <>
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatCard label="Saldo de vacaciones" value={`${saldo} dias`} />
              <StatCard label="Volantes disponibles" value={String(volantes.length)} />
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Mi expediente</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">Nombre</p>
                    <p className="text-[var(--color-text-primary)]">
                      {yo.first_name} {yo.last_name}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">Puesto</p>
                    <p className="text-[var(--color-text-primary)]">{yo.position}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">Desde</p>
                    <p className="text-[var(--color-text-primary)]">{fechaCorta(yo.hire_date)}</p>
                  </div>
                </div>
                {puedeEditar && (
                  <form action={editarMiTelefonoForm} className="flex items-end gap-3">
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Telefono
                      <input name="phone" defaultValue={yo.phone ?? ''} className={claseInput} />
                    </label>
                    <button
                      type="submit"
                      className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                    >
                      <Icon name="save" size={18} />
                      Guardar
                    </button>
                  </form>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mis volantes</CardTitle>
              </CardHeader>
              <CardBody>
                {volantes.length === 0 ? (
                  <EmptyState icon="receipt_long" title="Todavia no hay ningun volante" description="" />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Periodo</TH>
                        <TH numeric>Bruto</TH>
                        <TH numeric>TSS</TH>
                        <TH numeric>ISR</TH>
                        <TH numeric>Neto</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {volantes.map((v, i) => (
                        <TR key={i}>
                          <TD>
                            {fechaCorta(v.period_start)} → {fechaCorta(v.period_end)}
                          </TD>
                          <TD numeric>
                            <span className="tabular">{money(Number(v.gross_salary))}</span>
                          </TD>
                          <TD numeric>
                            <span className="tabular">{money(Number(v.tss_deduction))}</span>
                          </TD>
                          <TD numeric>
                            <span className="tabular">{money(Number(v.income_tax))}</span>
                          </TD>
                          <TD numeric>
                            <span className="tabular font-semibold text-[var(--color-text-primary)]">
                              {money(Number(v.net_salary))}
                            </span>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mis vacaciones</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {solicitudes.length === 0 ? (
                  <EmptyState icon="beach_access" title="Todavia no has pedido vacaciones" description="" />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Desde</TH>
                        <TH>Hasta</TH>
                        <TH numeric>Dias</TH>
                        <TH>Estado</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {solicitudes.map((s) => (
                        <TR key={s.id}>
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
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}

                {puedeSolicitar && (
                  <form action={solicitarDesdePortalForm} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Desde
                      <input type="date" name="startDate" required className={claseInput} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Hasta
                      <input type="date" name="endDate" required className={claseInput} />
                    </label>
                    <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Motivo (opcional)
                      <input name="reason" className={claseInput} />
                    </label>
                    <button
                      type="submit"
                      className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                    >
                      <Icon name="send" size={18} />
                      Pedir vacaciones
                    </button>
                  </form>
                )}
              </CardBody>
            </Card>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Anuncios</CardTitle>
          </CardHeader>
          <CardBody>
            {anuncios.length === 0 ? (
              <EmptyState icon="campaign" title="Todavia no hay ningun anuncio" description="" />
            ) : (
              <ul className="space-y-3">
                {anuncios.map((a) => (
                  <li key={a.id} className="border-b border-[var(--color-border-subtle)] pb-3 last:border-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-[var(--color-text-primary)]">{a.title}</p>
                      {esAnuncioVigente(new Date(a.published_at), hoy) && (
                        <Badge tone="info">Nuevo</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{a.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
