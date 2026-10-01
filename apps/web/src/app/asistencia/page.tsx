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
import { horaEsperadaEnRD, lateMinutes, overtimeHours, workedHours } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { marcarEntradaForm, marcarSalidaForm } from './actions'
import { METODO_MARCAJE } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'
import { diaRD, fechaHoraRD, horasEnTexto, hoyRD } from '@/lib/fechas-rd'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Asistencia · REGB ERP' }

interface MarcajeRow {
  id: string
  employee_name: string
  check_in: string
  check_out: string | null
  check_in_method: string
  within_geofence: boolean | null
}

interface EmpleadoOption {
  id: string
  name: string
}

interface SucursalOption {
  id: string
  name: string
}

// 8:00 a. m. para todos: todavía no hay horarios por empleado (limitación
// conocida de la ronda 3). La pantalla lo dice, para que nadie lea una
// "tardanza" de quien entra a las 9:00 por turno.
const HORA_ESPERADA = 8

/** Asistencia (modulo 63): marcaje con geocerca, horas extra y tardanza calculadas. */
export default async function AsistenciaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'attendance')

  const [marcajes, empleados, sucursales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const m = await tx<MarcajeRow[]>`
      select ar.id, e.first_name || ' ' || e.last_name as employee_name,
             ar.check_in::text, ar.check_out::text, ar.check_in_method, ar.within_geofence
      from public.attendance_records ar
      join public.employees e on e.id = ar.employee_id
      where ar.tenant_id = ${ctx.tenantId}
      order by ar.check_in desc
      limit 50`

    const e = await tx<EmpleadoOption[]>`
      select id, first_name || ' ' || last_name as name from public.employees
      where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`

    const s = await tx<SucursalOption[]>`
      select id, name from public.branches where tenant_id = ${ctx.tenantId} order by name`

    return [m, e, s] as const
  })

  const abiertos = marcajes.filter((m) => !m.check_out)
  // Hoy en RD: antes el recuadro contaba los ultimos 50 marcajes de
  // cualquier dia y decia que eran de hoy.
  const hoy = hoyRD()
  const deHoy = marcajes.filter((m) => diaRD(m.check_in) === hoy)
  // Una entrada de OTRO día sin salida no es "abierta": alguien olvidó marcar.
  const olvidados = abiertos.filter((m) => diaRD(m.check_in) !== hoy)
  const tardanzasHoy = deHoy.filter(
    (m) =>
      lateMinutes(new Date(m.check_in), horaEsperadaEnRD(new Date(m.check_in), HORA_ESPERADA)) > 0,
  ).length
  const puedeMarcar = exigir(ctx, 'attendance', 'attendance.check-in').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/asistencia">
      <div className="space-y-5">
        <PageHeader
          icon="fingerprint"
          title="Asistencia"
          description="Quién entró, a qué hora y cuándo salió. Las horas, la hora extra y la tardanza salen de la hora real del marcaje, nunca se escriben a mano."
          actions={
            <a
              href={`/asistencia/geocercas${qs}`}
              className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="fence" size={18} />
              Geocercas
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Adentro ahora"
            value={String(abiertos.length - olvidados.length)}
            hint="entraron hoy y no han salido"
          />
          <StatCard
            label="Entradas de hoy"
            value={String(deHoy.length)}
            hint={
              tardanzasHoy > 0
                ? `${tardanzasHoy} después de las 8:10 a. m.`
                : 'ninguna después de las 8:10 a. m.'
            }
          />
          <StatCard
            label="Salidas sin marcar"
            value={String(olvidados.length)}
            hint={
              olvidados.length === 0
                ? 'todo cerrado'
                : puedeMarcar
                  ? 'de días anteriores: ciérralas con «Salida»'
                  : 'de días anteriores, todavía abiertas'
            }
          />
        </section>

        {marcajes.length === 0 ? (
          <EmptyState
            icon="fingerprint"
            title="Todavía no hay ningún marcaje"
            description="Aquí sale cada entrada y salida del equipo. Los empleados marcan desde la app del teléfono; también puedes registrar una entrada abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH>Entrada</TH>
                <TH>Salida</TH>
                <TH numeric>Horas</TH>
                <TH numeric>
                  <span title="Lo que pasa de 8 horas entre la entrada y la salida">Extra*</span>
                </TH>
                <TH numeric>
                  <span title="Minutos después de las 8:10 a. m., igual para todos">Tardanza*</span>
                </TH>
                <TH className="hidden sm:table-cell">Método</TH>
                {puedeMarcar && (
                  <TH>
                    <span className="sr-only">Acción</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {marcajes.map((m) => {
                const entrada = new Date(m.check_in)
                const salida = m.check_out ? new Date(m.check_out) : null
                const horas = salida ? workedHours(entrada, salida) : null
                const extra = horas !== null ? overtimeHours(horas) : null
                const esperado = horaEsperadaEnRD(entrada, HORA_ESPERADA)
                const tardanza = lateMinutes(entrada, esperado)
                const olvidado = !m.check_out && diaRD(m.check_in) !== hoy
                return (
                  <TR key={m.id}>
                    <TD className="text-[var(--color-text-primary)]">{m.employee_name}</TD>
                    <TD className="whitespace-nowrap">{fechaHoraRD(m.check_in)}</TD>
                    <TD className="whitespace-nowrap">
                      {m.check_out ? (
                        fechaHoraRD(m.check_out)
                      ) : olvidado ? (
                        <Badge tone="danger">Sin salida</Badge>
                      ) : (
                        <Badge tone="warning">Adentro</Badge>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular whitespace-nowrap">
                        {horas === null ? '—' : horasEnTexto(horas)}
                      </span>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular whitespace-nowrap ${extra ? 'text-[var(--color-semantic-text-warning)]' : ''}`}
                      >
                        {extra ? horasEnTexto(extra) : '—'}
                      </span>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular ${tardanza > 0 ? 'text-[var(--color-semantic-text-danger)]' : ''}`}
                      >
                        {tardanza > 0 ? `${tardanza} min` : '—'}
                      </span>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      {METODO_MARCAJE[m.check_in_method] ?? m.check_in_method}
                      {m.within_geofence === false && (
                        <span className="ml-1 text-xs font-semibold text-[var(--color-semantic-text-danger)]">
                          fuera del radio
                        </span>
                      )}
                    </TD>
                    {puedeMarcar && (
                      <TD>
                        {!m.check_out && (
                          <form action={marcarSalidaForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="recordId" value={m.id} />
                            <BotonEnvio className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                              <Icon name="logout" size={14} />
                              Salida
                            </BotonEnvio>
                          </form>
                        )}
                      </TD>
                    )}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
        {marcajes.length > 0 && (
          <p className="-mt-2 text-xs text-[var(--color-text-muted)]">
            * Todavía no hay horarios por empleado: la tardanza son los minutos después de las 8:10
            a. m. (8:00 con 10 minutos de gracia) y la hora extra es lo que pasa de 8 horas entre la
            entrada y la salida, sin descontar el almuerzo. Igual para todos: quien tenga otro
            horario puede salir con tardanza o con extra sin tenerla.
          </p>
        )}

        {puedeMarcar && empleados.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Marcar entrada</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={marcarEntradaForm} className="flex flex-wrap items-end gap-3">
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
                  Sucursal (para geocerca)
                  <select name="branchId" defaultValue="" className={claseInput}>
                    <option value="">Sin verificar geocerca</option>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Latitud
                  <input
                    name="lat"
                    inputMode="decimal"
                    placeholder="18.4861"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Longitud
                  <input
                    name="lng"
                    inputMode="decimal"
                    placeholder="-69.9312"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="login" size={18} />
                  Marcar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                La latitud y la longitud son opcionales: sin ellas, el marcaje queda como manual. La
                app del teléfono las completa sola con el GPS.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
