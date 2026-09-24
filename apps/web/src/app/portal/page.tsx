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
import { misVolantes, resolverMiEmpleado, type MiVolante } from './mi-empleado'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mi portal · REGB ERP' }

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
export default async function PortalPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'hr-portal')

  const { yo, volantes, solicitudes, tomado, pendientes, anuncios } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      // Quien mira y sus volantes se le preguntan a la base POR EL TOKEN
      // (0132): por el vinculo que asigno RRHH, nunca por correo.
      const yo = await resolverMiEmpleado(tx)

      const an = await tx<AnuncioRow[]>`
        select id, title, body, published_at::text from public.hr_announcements
        where tenant_id = ${ctx.tenantId} order by published_at desc limit 10`

      if (!yo) {
        return {
          yo: null,
          volantes: [] as MiVolante[],
          solicitudes: [],
          tomado: 0,
          pendientes: 0,
          anuncios: an,
        }
      }

      const v = await misVolantes(tx, 12)

      const s = await tx<SolicitudRow[]>`
        select id, start_date::text, end_date::text, business_days, status
        from public.time_off_requests
        where tenant_id = ${ctx.tenantId} and employee_id = ${yo.id}
        order by start_date desc
        limit 12`

      const [t] = await tx<{ dias: string; pendientes: string }[]>`
        select coalesce(sum(business_days) filter (where status = 'approved'), 0)::text as dias,
               coalesce(sum(business_days) filter (where status = 'pending'), 0)::text as pendientes
        from public.time_off_requests
        where tenant_id = ${ctx.tenantId} and employee_id = ${yo.id}
          and leave_type = 'vacation' and status in ('approved', 'pending')`

      return {
        yo,
        volantes: v,
        solicitudes: s,
        tomado: Number(t?.dias ?? 0),
        pendientes: Number(t?.pendientes ?? 0),
        anuncios: an,
      }
    },
  )

  const puedeEditar = exigir(ctx, 'hr-portal', 'hr-portal.edit-profile').ok
  const puedeSolicitar = exigir(ctx, 'hr-portal', 'hr-portal.request-time-off').ok
  const qs = ctx.demoQs
  const hoy = new Date()

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  const saldo = yo ? saldoVacaciones(new Date(`${yo.hire_date}T00:00:00`), hoy, tomado) : 0
  // Quien no ha cumplido el año todavia no tiene dias (art. 177): se le
  // dice desde cuando puede irse, en vez de dejarlo descubrirlo con un error.
  const primerAniversario = (() => {
    if (!yo || yo.hire_date.slice(0, 10) === '') return null
    const [y, m, d] = yo.hire_date.slice(0, 10).split('-').map(Number)
    const aniversario = new Date(y! + 1, m! - 1, d!)
    return aniversario > hoy ? aniversario : null
  })()

  return (
    <Shell {...shell} activePath="/portal">
      <div className="space-y-5">
        <PageHeader
          icon="badge"
          title="Mi portal"
          description="Tu expediente, tus volantes y tu saldo de vacaciones. Solo ves lo tuyo."
        />

        {!yo ? (
          <EmptyState
            icon="badge"
            title="Tu cuenta no está vinculada a un expediente"
            description="Para ver tus volantes, RRHH tiene que vincular tu cuenta con tu expediente desde Empleados. No lo buscamos por tu correo: dos personas pueden compartirlo, y aquí solo se ve lo tuyo."
          />
        ) : (
          <>
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatCard
                label="Saldo de vacaciones"
                value={`${saldo} día${saldo === 1 ? '' : 's'}`}
                hint={
                  pendientes > 0
                    ? `${pendientes} pedido${pendientes === 1 ? '' : 's'}, por aprobar`
                    : undefined
                }
              />
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
                    <p className="text-[var(--color-text-primary)]">
                      {fechaCorta(yo.hire_date)} {yo.hire_date.slice(0, 4)}
                    </p>
                  </div>
                </div>
                {puedeEditar && (
                  <form action={editarMiTelefonoForm} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Teléfono
                      <input
                        name="phone"
                        type="tel"
                        defaultValue={yo.phone ?? ''}
                        className={claseInput}
                      />
                    </label>
                    <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="save" size={18} />
                      Guardar
                    </BotonEnvio>
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
                  <EmptyState
                    icon="receipt_long"
                    title="Todavía no hay ningún volante"
                    description="Cuando RRHH procese tu primera nómina, tu volante aparece aquí."
                  />
                ) : (
                  <>
                    {/* En el teléfono, un volante por tarjeta: la tabla de ocho
                      columnas obligaba a desplazarse de lado para ver el neto. */}
                    <ul className="space-y-3 sm:hidden" aria-label="Mis volantes">
                      {volantes.map((v) => (
                        <li
                          key={v.period_id}
                          className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                              {fechaCorta(v.period_start)} – {fechaCorta(v.period_end)}
                            </p>
                            <p className="tabular text-base font-bold text-[var(--color-text-primary)]">
                              RD$ {money(Number(v.net_salary))}
                            </p>
                          </div>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            Neto · se paga el {fechaCorta(v.pay_date)}
                            {v.paid_days !== null ? ` · ${Number(v.paid_days)} días` : ''}
                          </p>
                          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                            {(
                              [
                                ['Bruto', v.gross_salary, false],
                                ['Reembolsos', v.reimbursements, false],
                                ['TSS', v.tss_deduction, true],
                                ['ISR', v.income_tax, true],
                                ['Préstamos y otros', v.other_deductions, true],
                              ] as const
                            ).map(([etiqueta, monto, resta]) => (
                              <div key={etiqueta} className="contents">
                                <dt className="text-[var(--color-text-secondary)]">{etiqueta}</dt>
                                <dd className="tabular text-right text-[var(--color-text-primary)]">
                                  {resta && Number(monto) > 0 ? '−' : ''}
                                  {money(Number(monto))}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden overflow-x-auto sm:block">
                      <Table>
                        <THead>
                          <TR>
                            <TH>Período</TH>
                            <TH numeric>Días</TH>
                            <TH numeric>Bruto</TH>
                            <TH numeric>Reembolsos</TH>
                            <TH numeric>TSS</TH>
                            <TH numeric>ISR</TH>
                            <TH numeric>Descuentos</TH>
                            <TH numeric>Neto</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {volantes.map((v) => (
                            <TR key={v.period_id}>
                              <TD>
                                {fechaCorta(v.period_start)} → {fechaCorta(v.period_end)}
                              </TD>
                              <TD numeric>
                                <span className="tabular">
                                  {v.paid_days === null ? '—' : Number(v.paid_days)}
                                </span>
                              </TD>
                              <TD numeric>
                                <span className="tabular">{money(Number(v.gross_salary))}</span>
                              </TD>
                              <TD numeric>
                                <span className="tabular">{money(Number(v.reimbursements))}</span>
                              </TD>
                              <TD numeric>
                                <span className="tabular">{money(Number(v.tss_deduction))}</span>
                              </TD>
                              <TD numeric>
                                <span className="tabular">{money(Number(v.income_tax))}</span>
                              </TD>
                              <TD numeric>
                                <span className="tabular">{money(Number(v.other_deductions))}</span>
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
                    </div>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mis vacaciones</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {solicitudes.length === 0 ? (
                  <EmptyState
                    icon="beach_access"
                    title="Todavía no has pedido vacaciones"
                    description="Elige las fechas abajo. Se cuentan solo los días laborables."
                  />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Desde</TH>
                        <TH>Hasta</TH>
                        <TH numeric>Días</TH>
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

                {puedeSolicitar && primerAniversario && (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Tus primeros 14 días de vacaciones se ganan al cumplir un año, el{' '}
                    {primerAniversario.toLocaleDateString('es-DO', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                    . Puedes pedirlos desde ya para fechas a partir de ese día.
                  </p>
                )}
                {puedeSolicitar && (
                  <form
                    action={solicitarDesdePortalForm}
                    className="flex flex-wrap items-end gap-3"
                  >
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
                    <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                      <Icon name="send" size={18} />
                      Pedir vacaciones
                    </BotonEnvio>
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
              <EmptyState icon="campaign" title="Todavía no hay ningún anuncio" description="" />
            ) : (
              <ul className="space-y-3">
                {anuncios.map((a) => (
                  <li
                    key={a.id}
                    className="border-b border-[var(--color-border)] pb-3 last:border-0"
                  >
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
