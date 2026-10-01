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
import { crearVehiculoForm } from './actions'
import { ESTADO_VEHICULO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Flota de vehículos · REGB ERP' }

interface VehiculoRow {
  id: string
  plate: string
  brand: string
  model: string
  year: number | null
  status: string
  odometer_km: string
  driver_name: string | null
  documentos_vencidos: string
  multas_pendientes: string
  proximo_vence: string | null
}

interface EmpleadoOption {
  id: string
  name: string
}

const badgeEstado = (estado: string): 'success' | 'warning' | 'neutral' => {
  if (estado === 'active') return 'success'
  if (estado === 'maintenance') return 'warning' // registry:allow -- estado de vehiculo, no id de modulo
  return 'neutral'
}

/** Flota & Vehiculos (modulo 54): combustible, mantenimiento, licencias y multas. */
export default async function FlotaPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'fleet')

  const { vehiculos, empleados } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const v = await tx<VehiculoRow[]>`
      select veh.id, veh.plate, veh.brand, veh.model, veh.year, veh.status, veh.odometer_km::text,
             (e.first_name || ' ' || e.last_name) as driver_name,
             (select count(*) from public.vehicle_documents d
               where d.vehicle_id = veh.id and d.expiry_date < current_date)::text as documentos_vencidos,
             (select count(*) from public.traffic_fines f
               where f.vehicle_id = veh.id and f.status in ('pending', 'disputed'))::text as multas_pendientes,
             (select min(d.expiry_date) from public.vehicle_documents d
               where d.vehicle_id = veh.id and d.expiry_date >= current_date)::text as proximo_vence
      from public.vehicles veh
      left join public.employees e on e.id = veh.assigned_driver_id
      where veh.tenant_id = ${ctx.tenantId}
      order by veh.plate`
    const e = await tx<EmpleadoOption[]>`
      select id, first_name || ' ' || last_name as name from public.employees
      where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`
    return { vehiculos: v, empleados: e }
  })

  const enMantenimiento = vehiculos.filter((v) => v.status === 'maintenance').length // registry:allow -- estado de vehiculo, no id de modulo
  const conDocVencido = vehiculos.filter((v) => Number(v.documentos_vencidos) > 0).length
  const conMultaPendiente = vehiculos.filter((v) => Number(v.multas_pendientes) > 0).length

  const puedeGestionar = exigir(ctx, 'fleet', 'fleet.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/flota">
      <div className="space-y-5">
        <PageHeader
          icon="local_shipping"
          title="Flota de vehículos"
          description="Los vehículos del negocio con su chofer, el kilometraje, el combustible, los servicios, los papeles (seguro, licencia, inspección) y las multas."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Vehículos" value={String(vehiculos.length)} />
          <StatCard label="En el taller" value={String(enMantenimiento)} hint="fuera de servicio" />
          <StatCard
            label="Con papeles vencidos"
            value={String(conDocVencido)}
            hint="no deberían salir a la calle"
          />
          <StatCard
            label="Con multa pendiente"
            value={String(conMultaPendiente)}
            hint="por pagar o impugnar"
          />
        </section>

        {vehiculos.length === 0 ? (
          <EmptyState
            icon="local_shipping"
            title="Todavía no hay ningún vehículo"
            description="Registra abajo el camión, la camioneta o el motor de reparto con su placa y su chofer. Después le anotas el combustible, los servicios y el vencimiento del seguro."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Placa</TH>
                <TH>Vehículo</TH>
                <TH>Chofer</TH>
                <TH numeric>Kilometraje</TH>
                <TH>Estado</TH>
                <TH>Papeles y multas</TH>
              </TR>
            </THead>
            <TBody>
              {vehiculos.map((v) => (
                <TR key={v.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/flota/${v.id}${qs}`} className="underline-offset-2 hover:underline">
                      {v.plate}
                    </a>
                  </TD>
                  <TD>
                    {v.brand} {v.model}
                    {v.year ? ` ${v.year}` : ''}
                  </TD>
                  <TD>{v.driver_name ?? 'Sin chofer'}</TD>
                  <TD numeric>
                    <span className="tabular">
                      {Number(v.odometer_km).toLocaleString('es-DO')} km
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(v.status)}>
                      {ESTADO_VEHICULO[v.status] ?? v.status}
                    </Badge>
                  </TD>
                  <TD>
                    <span className="flex flex-wrap items-center gap-1">
                      {Number(v.documentos_vencidos) > 0 && (
                        <Badge tone="danger">
                          {v.documentos_vencidos === '1'
                            ? '1 papel vencido'
                            : `${v.documentos_vencidos} papeles vencidos`}
                        </Badge>
                      )}
                      {Number(v.multas_pendientes) > 0 && (
                        <Badge tone="warning">
                          {v.multas_pendientes === '1'
                            ? '1 multa'
                            : `${v.multas_pendientes} multas`}
                        </Badge>
                      )}
                      {Number(v.documentos_vencidos) === 0 && Number(v.multas_pendientes) === 0 && (
                        <span className="text-xs text-[var(--color-text-muted)]">
                          {v.proximo_vence
                            ? `En regla; el próximo vence el ${new Date(v.proximo_vence).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
                            : 'Sin papeles registrados'}
                        </span>
                      )}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo vehículo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearVehiculoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Placa
                  <input
                    name="plate"
                    required
                    placeholder="L452187"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Marca
                  <input
                    name="brand"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Modelo
                  <input
                    name="model"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Año
                  <input
                    name="year"
                    inputMode="numeric"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Chofer asignado
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
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
