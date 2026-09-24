import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  Mono,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { calcularMtbfDias, equipoRequiereMantenimiento } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearOrdenForm, registrarServicioForm } from '../../actions'
import { ESTADO_EQUIPO, ESTADO_ORDEN, TIPO_ORDEN } from '../../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface EquipoHead {
  id: string
  code: string
  name: string
  location: string | null
  status: string
  usage_hours: string
  last_service_at: string | null
  last_service_usage: string | null
  maintenance_interval_usage: string | null
  maintenance_interval_days: number | null
}

interface OrdenRow {
  id: string
  type: string
  status: string
  description: string
  opened_at: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-DO', { dateStyle: 'medium' })
const badgeEstado = (s: string): 'success' | 'warning' | 'neutral' => {
  if (s === 'completed') return 'success'
  if (s === 'open' || s === 'in_progress') return 'warning'
  return 'neutral'
}

/** Detalle de un equipo (modulo 59): uso, vencimiento, MTBF y sus ordenes de trabajo. */
export default async function EquipoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'maintenance', 'maintenance.manage')

  const { head, ordenes, mtbf } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<EquipoHead[]>`
      select id, code, name, location, status, usage_hours::text, last_service_at::text,
             last_service_usage::text, maintenance_interval_usage::text, maintenance_interval_days
      from public.equipment
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, ordenes: [], mtbf: null }

    const o = await tx<OrdenRow[]>`
      select id, type, status, description, opened_at::text
      from public.work_orders
      where equipment_id = ${id} and tenant_id = ${ctx.tenantId}
      order by opened_at desc`

    const fallas = await tx<{ opened_at: string }[]>`
      select opened_at::text from public.work_orders
      where equipment_id = ${id} and tenant_id = ${ctx.tenantId} and type = 'corrective'`

    const dias = calcularMtbfDias(fallas.map((f) => new Date(f.opened_at)))

    return { head: h, ordenes: o, mtbf: dias }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'maintenance', 'maintenance.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="equipmentId" value={head.id} />
    </>
  )

  const fechaLimite =
    head.maintenance_interval_days && head.last_service_at
      ? new Date(
          new Date(head.last_service_at).getTime() + head.maintenance_interval_days * 86_400_000,
        )
      : null
  const vencido = equipoRequiereMantenimiento(
    Number(head.usage_hours),
    Number(head.last_service_usage ?? 0),
    Number(head.maintenance_interval_usage ?? Infinity),
    fechaLimite,
    new Date(),
  )

  return (
    <Shell {...shell} activePath="/mantenimiento">
      <div className="space-y-5">
        <PageHeader
          icon="precision_manufacturing"
          title={`${head.code} · ${head.name}`}
          crumbs={[
            { label: 'Mantenimiento', href: `/mantenimiento${qs}` },
            { label: 'Equipos', href: `/mantenimiento/equipos${qs}` },
            { label: head.code },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={head.status === 'active' ? 'success' : 'neutral'}>
                {ESTADO_EQUIPO[head.status] ?? head.status}
              </Badge>
              {vencido ? (
                <Badge tone="danger">Mantenimiento vencido</Badge>
              ) : (
                <Badge tone="success">Al día</Badge>
              )}
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Uso acumulado"
            value={Number(head.usage_hours).toLocaleString('es-DO')}
          />
          <StatCard
            label="Ultimo servicio"
            value={head.last_service_at ? fecha(head.last_service_at) : 'Nunca'}
          />
          <StatCard label="MTBF" value={mtbf === null ? '—' : `${mtbf.toFixed(1)} días`} />
        </section>

        <Table>
          <THead>
            <TR>
              <TH>Orden</TH>
              <TH>Tipo</TH>
              <TH>Estado</TH>
              <TH>Abierta</TH>
            </TR>
          </THead>
          <TBody>
            {ordenes.length === 0 ? (
              <TR>
                <TD colSpan={4} className="text-center text-[var(--color-text-muted)]">
                  Este equipo todavía no tiene ninguna orden de trabajo.
                </TD>
              </TR>
            ) : (
              ordenes.map((o) => (
                <TR key={o.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a
                      href={`/mantenimiento/ordenes/${o.id}${qs}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {o.description}
                    </a>
                  </TD>
                  <TD>{TIPO_ORDEN[o.type] ?? o.type}</TD>
                  <TD>
                    <Badge tone={badgeEstado(o.status)}>{ESTADO_ORDEN[o.status] ?? o.status}</Badge>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">
                    <Mono>{fecha(o.opened_at)}</Mono>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {puedeGestionar && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Nueva orden de trabajo</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={crearOrdenForm} className="flex flex-wrap items-end gap-3">
                  {campos}
                  <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Tipo
                    <select name="type" required className={claseInput}>
                      <option value="corrective">Correctivo</option>
                      <option value="preventive">Preventivo</option>
                    </select>
                  </label>
                  <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Prioridad
                    <select name="priority" defaultValue="normal" className={claseInput}>
                      <option value="low">Baja</option>
                      <option value="normal">Normal</option>
                      <option value="high">Alta</option>
                      <option value="urgent">Urgente</option>
                    </select>
                  </label>
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Descripcion
                    <input name="description" required className={claseInput} />
                  </label>
                  <BotonEnvio className={botonClase}>
                    <Icon name="add" size={14} />
                    Crear
                  </BotonEnvio>
                </form>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Registrar servicio</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={registrarServicioForm} className="flex flex-wrap items-end gap-3">
                  {campos}
                  <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Lectura de uso actual
                    <input
                      name="usageAtService"
                      required
                      inputMode="decimal"
                      className={`tabular ${claseInput}`}
                    />
                  </label>
                  <BotonEnvio className={botonClase}>
                    <Icon name="check_circle" size={14} />
                    Registrar
                  </BotonEnvio>
                </form>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </Shell>
  )
}
