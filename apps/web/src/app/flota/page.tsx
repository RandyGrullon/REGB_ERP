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
export const metadata = { title: 'Flota · REGB ERP' }

interface VehiculoRow {
  id: string
  plate: string
  brand: string
  model: string
  status: string
  odometer_km: string
  driver_name: string | null
  documentos_vencidos: string
  multas_pendientes: string
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
export default async function FlotaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'fleet')

  const { vehiculos, empleados } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const v = await tx<VehiculoRow[]>`
      select veh.id, veh.plate, veh.brand, veh.model, veh.status, veh.odometer_km::text,
             (e.first_name || ' ' || e.last_name) as driver_name,
             (select count(*) from public.vehicle_documents d
               where d.vehicle_id = veh.id and d.expiry_date < current_date)::text as documentos_vencidos,
             (select count(*) from public.traffic_fines f
               where f.vehicle_id = veh.id and f.status in ('pending', 'disputed'))::text as multas_pendientes
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
          title="Flota"
          description="Combustible, mantenimiento vencido por km o por fecha, documentos con vigencia real y multas con flujo de estados."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Vehiculos" value={String(vehiculos.length)} />
          <StatCard label="En mantenimiento" value={String(enMantenimiento)} />
          <StatCard label="Con documento vencido" value={String(conDocVencido)} />
          <StatCard label="Con multa pendiente" value={String(conMultaPendiente)} />
        </section>

        {vehiculos.length === 0 ? (
          <EmptyState icon="local_shipping" title="Todavia no hay ningun vehiculo" description="" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Placa</TH>
                <TH>Vehiculo</TH>
                <TH>Conductor</TH>
                <TH numeric>Kilometraje</TH>
                <TH>Estado</TH>
                <TH>Alertas</TH>
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
                  </TD>
                  <TD>{v.driver_name ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">{Number(v.odometer_km).toLocaleString('es-DO')}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(v.status)}>{ESTADO_VEHICULO[v.status] ?? v.status}</Badge>
                  </TD>
                  <TD>
                    {Number(v.documentos_vencidos) > 0 && (
                      <Badge tone="danger" className="mr-1">
                        {v.documentos_vencidos} doc. vencido
                      </Badge>
                    )}
                    {Number(v.multas_pendientes) > 0 && (
                      <Badge tone="warning">{v.multas_pendientes} multa</Badge>
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
              <CardTitle>Nuevo vehiculo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearVehiculoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Placa
                  <input name="plate" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Marca
                  <input name="brand" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Modelo
                  <input name="model" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Ano
                  <input name="year" inputMode="numeric" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Conductor asignado
                  <select name="driverId" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]">
                    <option value="">Sin asignar</option>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
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
