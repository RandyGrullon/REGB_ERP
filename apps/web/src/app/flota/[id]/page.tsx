import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import {
  documentoVehiculoVigente,
  eficienciaCombustible,
  loteProximoAVencer,
  mantenimientoVencidoPorKm,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  registrarCombustibleForm,
  registrarDocumentoForm,
  registrarMantenimientoForm,
  registrarMultaForm,
  resolverMultaForm,
} from '../actions'
import { ESTADO_MULTA, ESTADO_VEHICULO, TIPO_DOCUMENTO } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface VehiculoHead {
  id: string
  plate: string
  brand: string
  model: string
  status: string
  odometer_km: string
  driver_name: string | null
}

interface DocumentoRow {
  id: string
  doc_type: string
  expiry_date: string
}

interface CombustibleRow {
  id: string
  filled_at: string
  liters: string
  cost: string
  odometer_km: string
}

interface MantenimientoRow {
  id: string
  service_date: string
  type: string
  description: string
  cost: string
  odometer_km: string
  next_due_km: string | null
}

interface MultaRow {
  id: string
  fine_date: string
  amount: string
  reason: string
  status: string
}

interface EmpleadoOption {
  id: string
  name: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Detalle de un vehiculo (modulo 54): documentos, combustible, mantenimiento, multas. */
export default async function VehiculoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'fleet')

  const { head, documentos, combustible, mantenimiento, multas, empleados } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [h] = await tx<VehiculoHead[]>`
        select veh.id, veh.plate, veh.brand, veh.model, veh.status, veh.odometer_km::text,
               (e.first_name || ' ' || e.last_name) as driver_name
        from public.vehicles veh
        left join public.employees e on e.id = veh.assigned_driver_id
        where veh.id = ${id} and veh.tenant_id = ${ctx.tenantId}`
      if (!h)
        return {
          head: null,
          documentos: [],
          combustible: [],
          mantenimiento: [],
          multas: [],
          empleados: [],
        }

      const d = await tx<DocumentoRow[]>`
        select id, doc_type, expiry_date::text from public.vehicle_documents
        where vehicle_id = ${id} and tenant_id = ${ctx.tenantId} order by expiry_date`
      const c = await tx<CombustibleRow[]>`
        select id, filled_at::text, liters::text, cost::text, odometer_km::text
        from public.fuel_logs where vehicle_id = ${id} and tenant_id = ${ctx.tenantId}
        order by filled_at`
      const m = await tx<MantenimientoRow[]>`
        select id, service_date::text, type, description, cost::text, odometer_km::text, next_due_km::text
        from public.maintenance_records where vehicle_id = ${id} and tenant_id = ${ctx.tenantId}
        order by service_date desc`
      const f = await tx<MultaRow[]>`
        select id, fine_date::text, amount::text, reason, status
        from public.traffic_fines where vehicle_id = ${id} and tenant_id = ${ctx.tenantId}
        order by fine_date desc`
      const e = await tx<EmpleadoOption[]>`
        select id, first_name || ' ' || last_name as name from public.employees
        where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`

      return { head: h, documentos: d, combustible: c, mantenimiento: m, multas: f, empleados: e }
    },
  )

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'fleet', 'fleet.manage').ok
  const puedeMultas = exigir(ctx, 'fleet', 'fleet.fines.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="vehicleId" value={head.id} />
    </>
  )

  const ahora = new Date()
  const ultimoMantenimiento = mantenimiento[0]
  const proximoVencido =
    ultimoMantenimiento?.next_due_km &&
    mantenimientoVencidoPorKm(
      Number(head.odometer_km),
      Number(ultimoMantenimiento.odometer_km),
      Number(ultimoMantenimiento.next_due_km) - Number(ultimoMantenimiento.odometer_km),
    )

  return (
    <Shell {...shell} activePath="/flota">
      <div className="space-y-5">
        <PageHeader
          icon="local_shipping"
          title={`${head.plate} · ${head.brand} ${head.model}`}
          description={
            head.driver_name ? `Conductor: ${head.driver_name}` : 'Sin conductor asignado'
          }
          crumbs={[{ label: 'Flota', href: `/flota${qs}` }, { label: head.plate }]}
          meta={
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  head.status === 'active'
                    ? 'success'
                    : head.status === 'maintenance'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {' '}
                {/* registry:allow -- estado de vehiculo, no id de modulo */}
                {ESTADO_VEHICULO[head.status] ?? head.status}
              </Badge>
              <span className="text-xs text-[var(--color-text-muted)]">
                {Number(head.odometer_km).toLocaleString('es-DO')} km
              </span>
              {proximoVencido && <Badge tone="danger">Mantenimiento vencido</Badge>}
            </div>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>Documentos</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Tipo</TH>
                  <TH>Vencimiento</TH>
                  <TH>Estado</TH>
                </TR>
              </THead>
              <TBody>
                {documentos.map((d) => {
                  const vence = new Date(d.expiry_date)
                  const vigente = documentoVehiculoVigente(vence, ahora)
                  const porVencer = vigente && loteProximoAVencer(vence, ahora)
                  return (
                    <TR key={d.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        {TIPO_DOCUMENTO[d.doc_type] ?? d.doc_type}
                      </TD>
                      <TD>{d.expiry_date}</TD>
                      <TD>
                        {!vigente ? (
                          <Badge tone="danger">Vencido</Badge>
                        ) : porVencer ? (
                          <Badge tone="warning">Por vencer</Badge>
                        ) : (
                          <Badge tone="success">Vigente</Badge>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            {puedeGestionar && (
              <form
                action={registrarDocumentoForm}
                className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] p-3"
              >
                {campos}
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select name="docType" required className={claseInput}>
                    <option value="license">Licencia</option>
                    <option value="insurance">Seguro</option>
                    <option value="inspection">Inspeccion</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vencimiento
                  <input type="date" name="expiryDate" required className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Agregar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Combustible</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH numeric>Litros</TH>
                  <TH numeric>Costo</TH>
                  <TH numeric>Kilometraje</TH>
                  <TH numeric>Rendimiento</TH>
                </TR>
              </THead>
              <TBody>
                {[...combustible].reverse().map((c, i, arr) => {
                  const anterior = arr[i + 1]
                  const rendimiento = anterior
                    ? eficienciaCombustible(
                        Number(c.odometer_km) - Number(anterior.odometer_km),
                        Number(c.liters),
                      )
                    : null
                  return (
                    <TR key={c.id}>
                      <TD>{new Date(c.filled_at).toLocaleDateString('es-DO')}</TD>
                      <TD numeric>
                        <span className="tabular">{c.liters}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">RD$ {money(Number(c.cost))}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {Number(c.odometer_km).toLocaleString('es-DO')}
                        </span>
                      </TD>
                      <TD numeric>
                        {rendimiento !== null && (
                          <span className="tabular">{rendimiento.toFixed(1)} km/gal</span>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            {puedeGestionar && (
              <form
                action={registrarCombustibleForm}
                className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] p-3"
              >
                {campos}
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Conductor
                  <select name="driverId" className={claseInput}>
                    <option value="">Sin especificar</option>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Litros
                  <input
                    name="liters"
                    required
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Costo
                  <input
                    name="cost"
                    required
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Kilometraje
                  <input
                    name="odometerKm"
                    required
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="local_gas_station" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mantenimiento</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Tipo</TH>
                  <TH>Descripción</TH>
                  <TH numeric>Costo</TH>
                  <TH numeric>Kilometraje</TH>
                </TR>
              </THead>
              <TBody>
                {mantenimiento.map((m) => (
                  <TR key={m.id}>
                    <TD>{m.service_date}</TD>
                    <TD>{m.type === 'preventive' ? 'Preventivo' : 'Correctivo'}</TD>
                    <TD className="max-w-56 truncate">{m.description}</TD>
                    <TD numeric>
                      <span className="tabular">RD$ {money(Number(m.cost))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">
                        {Number(m.odometer_km).toLocaleString('es-DO')}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {puedeGestionar && (
              <form
                action={registrarMantenimientoForm}
                className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] p-3"
              >
                {campos}
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select name="type" required className={claseInput}>
                    <option value="preventive">Preventivo</option>
                    <option value="corrective">Correctivo</option>
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input name="description" required className={claseInput} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Costo
                  <input name="cost" inputMode="decimal" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Kilometraje
                  <input
                    name="odometerKm"
                    required
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Próximo a km
                  <input name="nextDueKm" inputMode="decimal" className={`tabular ${claseInput}`} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="build" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Multas</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Fecha</TH>
                  <TH>Razón</TH>
                  <TH numeric>Monto</TH>
                  <TH>Estado</TH>
                  {puedeMultas && (
                    <TH>
                      <span className="sr-only">Acción</span>
                    </TH>
                  )}
                </TR>
              </THead>
              <TBody>
                {multas.map((m) => (
                  <TR key={m.id}>
                    <TD>{m.fine_date}</TD>
                    <TD className="max-w-48 truncate">{m.reason}</TD>
                    <TD numeric>
                      <span className="tabular">RD$ {money(Number(m.amount))}</span>
                    </TD>
                    <TD>
                      <Badge
                        tone={
                          m.status === 'paid'
                            ? 'success'
                            : m.status === 'dismissed'
                              ? 'neutral'
                              : m.status === 'disputed'
                                ? 'warning'
                                : 'danger'
                        }
                      >
                        {ESTADO_MULTA[m.status] ?? m.status}
                      </Badge>
                    </TD>
                    {puedeMultas && (
                      <TD>
                        <div className="flex gap-1.5">
                          {m.status === 'pending' && (
                            <>
                              <form action={resolverMultaForm}>
                                {campos}
                                <input type="hidden" name="fineId" value={m.id} />
                                <input type="hidden" name="siguiente" value="paid" />
                                <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                                  Pagar
                                </BotonEnvio>
                              </form>
                              <form action={resolverMultaForm}>
                                {campos}
                                <input type="hidden" name="fineId" value={m.id} />
                                <input type="hidden" name="siguiente" value="disputed" />
                                <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                                  Disputar
                                </BotonEnvio>
                              </form>
                            </>
                          )}
                          {m.status === 'disputed' && (
                            <>
                              <form action={resolverMultaForm}>
                                {campos}
                                <input type="hidden" name="fineId" value={m.id} />
                                <input type="hidden" name="siguiente" value="paid" />
                                <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                                  Pagar
                                </BotonEnvio>
                              </form>
                              <form action={resolverMultaForm}>
                                {campos}
                                <input type="hidden" name="fineId" value={m.id} />
                                <input type="hidden" name="siguiente" value="dismissed" />
                                <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                                  Descartar
                                </BotonEnvio>
                              </form>
                            </>
                          )}
                        </div>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
            {puedeMultas && (
              <form
                action={registrarMultaForm}
                className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] p-3"
              >
                {campos}
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Conductor
                  <select name="driverId" className={claseInput}>
                    <option value="">Sin especificar</option>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Razon
                  <input name="reason" required className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="receipt_long" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
