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
export const metadata = { title: 'Rutas · REGB ERP' }

interface RutaRow {
  id: string
  route_date: string
  driver_name: string | null
  vehicle_plate: string | null
  status: string
  paradas: string
  entregadas: string
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
export default async function RutasPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'logistics')

  const { rutas, empleados } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const r = await tx<RutaRow[]>`
      select dr.id, dr.route_date::text, (e.first_name || ' ' || e.last_name) as driver_name,
             dr.vehicle_plate, dr.status,
             (select count(*) from public.route_stops s where s.route_id = dr.id)::text as paradas,
             (select count(*) from public.route_stops s where s.route_id = dr.id and s.status = 'delivered')::text as entregadas
      from public.delivery_routes dr
      left join public.employees e on e.id = dr.driver_id
      where dr.tenant_id = ${ctx.tenantId}
      order by dr.route_date desc, dr.created_at desc
      limit 30`
    const e = await tx<EmpleadoOption[]>`
      select id, first_name || ' ' || last_name as name from public.employees
      where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`
    return { rutas: r, empleados: e }
  })

  const enProgreso = rutas.filter((r) => r.status === 'in_progress').length
  const puedeGestionar = exigir(ctx, 'logistics', 'logistics.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/rutas">
      <div className="space-y-5">
        <PageHeader
          icon="route"
          title="Rutas"
          description="Planificacion y prueba de entrega -quien recibio, no una firma digital-. Sin GPS ni optimizacion de ruta reales todavia."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="En progreso" value={String(enProgreso)} />
          <StatCard label="Total" value={String(rutas.length)} />
        </section>

        {rutas.length === 0 ? (
          <EmptyState icon="route" title="Todavia no hay ninguna ruta" description="Planifica la primera abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Fecha</TH>
                <TH>Conductor</TH>
                <TH>Vehiculo</TH>
                <TH numeric>Entregas</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {rutas.map((r) => (
                <TR key={r.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/rutas/${r.id}${qs}`} className="underline-offset-2 hover:underline">
                      {r.route_date}
                    </a>
                  </TD>
                  <TD>{r.driver_name ?? '—'}</TD>
                  <TD>{r.vehicle_plate ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">
                      {r.entregadas}/{r.paradas}
                    </span>
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
                  Conductor
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
                  Placa del vehiculo
                  <input
                    name="vehiclePlate"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
