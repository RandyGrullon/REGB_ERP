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
import { crearRutaForm } from './actions'
import { ESTADO_RUTA } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Rutas de reparto · REGB ERP' }

interface RutaRow {
  id: string
  route_date: string
  driver_name: string | null
  vehicle_plate: string | null
  status: string
  notes: string | null
  paradas: string
  entregadas: string
  fallidas: string
}

interface EmpleadoOption {
  id: string
  name: string
}

const badgeEstado = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'completed') return 'success'
  if (estado === 'in_progress') return 'warning'
  if (estado === 'cancelled') return 'danger'
  return 'neutral'
}

/** Rutas (modulo 53): planificacion y prueba de entrega -sin GPS ni optimizacion real-. */
export default async function RutasPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'logistics')

  const { rutas, empleados, vehiculos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const r = await tx<RutaRow[]>`
      select dr.id, dr.route_date::text, (e.first_name || ' ' || e.last_name) as driver_name,
             dr.vehicle_plate, dr.status, dr.notes,
             (select count(*) from public.route_stops s where s.route_id = dr.id)::text as paradas,
             (select count(*) from public.route_stops s where s.route_id = dr.id and s.status = 'delivered')::text as entregadas,
             (select count(*) from public.route_stops s where s.route_id = dr.id and s.status = 'failed')::text as fallidas
      from public.delivery_routes dr
      left join public.employees e on e.id = dr.driver_id
      where dr.tenant_id = ${ctx.tenantId}
      order by dr.route_date desc, dr.created_at desc
      limit 30`
    const e = await tx<EmpleadoOption[]>`
      select id, first_name || ' ' || last_name as name from public.employees
      where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`
    // Las placas de la flota, para no escribirlas a mano (si el negocio la tiene).
    const v = ctx.licensedModules.has('fleet')
      ? await tx<{ plate: string; label: string }[]>`
          select plate, brand || ' ' || model as label from public.vehicles
          where tenant_id = ${ctx.tenantId} and status = 'active' order by plate`
      : []
    return { rutas: r, empleados: e, vehiculos: v }
  })

  const enProgreso = rutas.filter((r) => r.status === 'in_progress').length
  const planificadas = rutas.filter((r) => r.status === 'planned').length
  // `route_date` es fecha sin hora: en UTC para que no salga un día antes.
  const dia = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
  const puedeGestionar = exigir(ctx, 'logistics', 'logistics.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/rutas">
      <div className="space-y-5">
        <PageHeader
          icon="route"
          title="Rutas de reparto"
          description="Los repartos del día: qué chofer sale, en qué vehículo y a qué clientes. En cada parada se anota quién recibió; eso es la prueba de entrega."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="En la calle" value={String(enProgreso)} hint="rutas en progreso" />
          <StatCard label="Por salir" value={String(planificadas)} hint="planificadas" />
          <StatCard label="Rutas" value={String(rutas.length)} hint="las últimas 30" />
        </section>

        {rutas.length === 0 ? (
          <EmptyState
            icon="route"
            title="Todavía no hay ninguna ruta"
            description="Planifica la primera abajo con la fecha, el chofer y el vehículo; después le agregas las paradas con la dirección de cada cliente."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Chofer</TH>
                <TH>Vehículo</TH>
                <TH numeric>Entregadas</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {rutas.map((r) => (
                <TR key={r.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a
                      href={`/rutas/${r.id}${qs}`}
                      className="whitespace-nowrap text-[var(--color-text-link)] underline-offset-2 hover:underline"
                    >
                      {dia(r.route_date)}
                    </a>
                    {r.notes && (
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {r.notes}
                      </span>
                    )}
                  </TD>
                  <TD>{r.driver_name ?? 'Sin chofer'}</TD>
                  <TD>{r.vehicle_plate ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">
                      {r.entregadas} de {r.paradas}
                    </span>
                    {Number(r.fallidas) > 0 && (
                      <span className="block text-xs text-[var(--color-semantic-text-danger)]">
                        {r.fallidas === '1' ? '1 fallida' : `${r.fallidas} fallidas`}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(r.status)}>{ESTADO_RUTA[r.status] ?? r.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Planificar ruta</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearRutaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input
                    type="date"
                    name="routeDate"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Chofer
                  <select
                    name="driverId"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Sin asignar</option>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Placa del vehículo
                  <input
                    name="vehiclePlate"
                    list="placas-flota"
                    autoComplete="off"
                    placeholder="L452187"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                  <datalist id="placas-flota">
                    {vehiculos.map((v) => (
                      <option key={v.plate} value={v.plate}>
                        {v.label}
                      </option>
                    ))}
                  </datalist>
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Planificar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
