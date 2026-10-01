import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import {
  rutaCompleta,
  tasaEntregaExitosa,
  type EstadoParada as EstadoParadaOp,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  agregarParadaForm,
  cancelarRutaForm,
  completarRutaForm,
  despacharRutaForm,
  resolverParadaForm,
} from '../actions'
import { ESTADO_PARADA, ESTADO_RUTA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface RutaHead {
  id: string
  status: string
  route_date: string
  driver_name: string | null
  driver_phone: string | null
  vehicle_plate: string | null
  notes: string | null
  started_at: string | null
  completed_at: string | null
}

interface ParadaRow {
  id: string
  sequence: number
  address: string
  customer_name: string | null
  status: string
  recipient_name: string | null
  delivery_notes: string | null
  delivered_at: string | null
  customer_phone: string | null
  order_number: string | null
}

interface ClienteOption {
  id: string
  name: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

/** Detalle de una ruta (modulo 53): paradas, despachar, prueba de entrega, completar. */
export default async function RutaDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'logistics')

  const { head, paradas, clientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<RutaHead[]>`
      select dr.id, dr.status, dr.route_date::text, (e.first_name || ' ' || e.last_name) as driver_name,
             e.phone as driver_phone, dr.vehicle_plate, dr.notes, dr.started_at::text,
             dr.completed_at::text
      from public.delivery_routes dr
      left join public.employees e on e.id = dr.driver_id
      where dr.id = ${id} and dr.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, paradas: [], clientes: [] }

    const p = await tx<ParadaRow[]>`
      select s.id, s.sequence, s.address, c.name as customer_name, s.status, s.recipient_name,
             s.delivery_notes, s.delivered_at::text, c.phone as customer_phone,
             so.number as order_number
      from public.route_stops s
      left join public.customers c on c.id = s.customer_id
      left join public.sales_orders so on so.id = s.sales_order_id
      where s.route_id = ${id} and s.tenant_id = ${ctx.tenantId}
      order by s.sequence`

    const c =
      h.status === 'planned'
        ? await tx<ClienteOption[]>`
            select id, name from public.customers
            where tenant_id = ${ctx.tenantId} and is_active order by name limit 200`
        : []

    return { head: h, paradas: p, clientes: c }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'logistics', 'logistics.manage').ok
  const puedeEntregar = exigir(ctx, 'logistics', 'logistics.deliver').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="routeId" value={head.id} />
    </>
  )

  const enPlanificacion = head.status === 'planned'
  const enProgreso = head.status === 'in_progress'
  const estadosParadas = paradas.map((p) => ({ status: p.status as EstadoParadaOp }))
  const tasaExito = tasaEntregaExitosa(estadosParadas)
  const completa = rutaCompleta(estadosParadas)
  // `route_date` es fecha sin hora: en UTC para que no salga un día antes.
  const diaRuta = new Date(head.route_date).toLocaleDateString('es-DO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  const hora = (iso: string) =>
    new Date(iso).toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' })
  const pendientes = paradas.filter((p) => p.status === 'pending').length

  return (
    <Shell {...shell} activePath="/rutas">
      <div className="space-y-5">
        <PageHeader
          icon="route"
          title={`Ruta del ${diaRuta}`}
          description={[
            head.driver_name
              ? `Chofer: ${head.driver_name}${head.driver_phone ? ` (${head.driver_phone})` : ''}`
              : 'Sin chofer asignado',
            head.vehicle_plate ? `vehículo ${head.vehicle_plate}` : null,
            head.started_at ? `salió a las ${hora(head.started_at)}` : null,
            head.completed_at ? `terminó a las ${hora(head.completed_at)}` : null,
            head.notes,
          ]
            .filter(Boolean)
            .join(' · ')}
          crumbs={[{ label: 'Rutas de reparto', href: `/rutas${qs}` }, { label: diaRuta }]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  head.status === 'completed'
                    ? 'success'
                    : head.status === 'in_progress'
                      ? 'warning'
                      : head.status === 'cancelled'
                        ? 'danger'
                        : 'neutral'
                }
              >
                {ESTADO_RUTA[head.status] ?? head.status}
              </Badge>
              {enPlanificacion && puedeGestionar && paradas.length > 0 && (
                <form action={despacharRutaForm}>
                  {campos}
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="local_shipping" size={14} />
                    Despachar
                  </BotonEnvio>
                </form>
              )}
              {enPlanificacion && puedeGestionar && (
                <form action={cancelarRutaForm}>
                  {campos}
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                    <Icon name="cancel" size={14} />
                    Cancelar
                  </BotonEnvio>
                </form>
              )}
              {enProgreso && puedeGestionar && completa && (
                <form action={completarRutaForm}>
                  {campos}
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-semantic-success)] px-3 text-xs font-medium text-white hover:opacity-90">
                    <Icon name="check_circle" size={14} />
                    Completar ruta
                  </BotonEnvio>
                </form>
              )}
            </div>
          }
        />

        {paradas.length > 0 && (
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard label="Paradas" value={String(paradas.length)} />
            <StatCard label="Por entregar" value={String(pendientes)} />
            <StatCard
              label="Entregas logradas"
              value={`${Math.round(tasaExito * 100)}%`}
              hint="de las ya visitadas"
            />
          </section>
        )}

        <Table>
          <THead>
            <TR>
              <TH>#</TH>
              <TH>Cliente</TH>
              <TH>Dirección</TH>
              <TH>Estado</TH>
              <TH>Prueba de entrega</TH>
              {enProgreso && puedeEntregar && <TH>Registrar entrega</TH>}
            </TR>
          </THead>
          <TBody>
            {paradas.length === 0 && (
              <TR>
                <TD colSpan={6} className="py-6 text-center text-[var(--color-text-muted)]">
                  {enPlanificacion
                    ? 'Esta ruta todavía no tiene paradas. Agrégalas abajo en el orden en que se van a visitar.'
                    : 'Esta ruta no tuvo paradas.'}
                </TD>
              </TR>
            )}
            {paradas.map((p) => (
              <TR key={p.id}>
                <TD numeric>
                  <span className="tabular">{p.sequence}</span>
                </TD>
                <TD className="text-[var(--color-text-primary)]">
                  {p.customer_name ?? 'Sin cliente'}
                  {(p.customer_phone || p.order_number) && (
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {[p.order_number ? `pedido ${p.order_number}` : null, p.customer_phone]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </TD>
                <TD className="max-w-64">
                  <span className="line-clamp-2">{p.address}</span>
                </TD>
                <TD>
                  <Badge
                    tone={
                      p.status === 'delivered'
                        ? 'success'
                        : p.status === 'failed'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {ESTADO_PARADA[p.status] ?? p.status}
                  </Badge>
                </TD>
                <TD>
                  {p.recipient_name ?? '—'}
                  {(p.delivered_at || p.delivery_notes) && (
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {[p.delivered_at ? hora(p.delivered_at) : null, p.delivery_notes]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </TD>
                {enProgreso && puedeEntregar && (
                  <TD className="min-w-52">
                    {p.status === 'pending' && (
                      <form
                        action={resolverParadaForm}
                        className="flex flex-wrap items-center gap-1"
                      >
                        {campos}
                        <input type="hidden" name="stopId" value={p.id} />
                        <input
                          name="recipientName"
                          placeholder="Quién recibió"
                          aria-label={`Quién recibió la parada ${p.sequence}`}
                          className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                        />
                        <BotonEnvio
                          name="siguiente"
                          value="delivered"
                          className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-semantic-text-success)] hover:bg-[var(--color-surface-raised)]"
                        >
                          Entregada
                        </BotonEnvio>
                        <BotonEnvio
                          name="siguiente"
                          value="failed"
                          className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]"
                        >
                          Fallida
                        </BotonEnvio>
                      </form>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>

        {enPlanificacion && puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Agregar parada</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={agregarParadaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente
                  <select name="customerId" className={claseInput}>
                    <option value="">Sin especificar</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Dirección
                  <input
                    name="address"
                    required
                    placeholder="Av. Duarte 214, Villa Consuelo"
                    className={claseInput}
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Agregar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
