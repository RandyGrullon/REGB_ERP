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
import { diasOrdenAbierta, type EstadoOrdenServicio } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearOrdenForm } from './actions'
import { ESTADO_ORDEN, PRIORIDAD_ORDEN } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Servicio en campo · REGB ERP' }

interface Orden {
  id: string
  code: string
  customer_name: string
  status: EstadoOrdenServicio
  priority: string
  scheduled_at: string | null
  description: string
  address: string | null
  created_at: string
  pasos_pendientes: string
  tecnico: string | null
}

interface TecnicoOption {
  user_id: string
  name: string
}

interface ClienteOption {
  id: string
  name: string
}

const inputClase =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'

const tonoEstado = (
  s: EstadoOrdenServicio,
): 'success' | 'danger' | 'warning' | 'info' | 'neutral' => {
  if (s === 'done') return 'success'
  if (s === 'cancelled') return 'danger'
  if (s === 'in_progress') return 'info'
  if (s === 'scheduled') return 'warning'
  return 'neutral'
}

/** Servicio en campo (modulo 74): una orden no se cierra a medias. */
export default async function ServicioEnCampoPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'field-service')
  // Quien solo ejecuta (el Técnico de Campo) ve las órdenes que tiene
  // asignadas; quien gestiona, todas.
  const puedeGestionar = exigir(ctx, 'field-service', 'field-service.manage').ok
  const soloMias = !puedeGestionar && exigir(ctx, 'field-service', 'field-service.view.assigned').ok

  const { ordenes, clientes, tecnicos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const o = await tx<Orden[]>`
      select so.id, so.code, c.name as customer_name, so.status, so.priority,
             so.scheduled_at::text, so.description, so.address, so.created_at::text,
             (select count(*) from public.service_checklist_items ci
              where ci.order_id = so.id and ci.required and not ci.done)::text as pasos_pendientes,
             up.display_name as tecnico
      from public.service_orders so
      join public.customers c on c.id = so.customer_id
      left join public.user_profiles up
        on up.tenant_id = so.tenant_id and up.user_id = so.technician_id
      where so.tenant_id = ${ctx.tenantId}
        and (${!soloMias} or so.technician_id = ${ctx.userId})
      order by
        case so.status when 'in_progress' then 0 when 'scheduled' then 1 when 'draft' then 2 else 3 end,
        so.scheduled_at nulls last, so.created_at desc`

    const c = await tx<ClienteOption[]>`
      select id, name from public.customers
      where tenant_id = ${ctx.tenantId} and is_active
      order by name limit 300`

    // A quién se le puede asignar: la gente con acceso activo al negocio.
    const t = puedeGestionar
      ? await tx<TecnicoOption[]>`
          select m.user_id, coalesce(up.display_name, up.email, 'Sin nombre') as name
          from public.memberships m
          left join public.user_profiles up on up.tenant_id = m.tenant_id and up.user_id = m.user_id
          where m.tenant_id = ${ctx.tenantId} and m.is_active
          order by name`
      : []

    return { ordenes: o, clientes: c, tecnicos: t }
  })

  const abiertas = ordenes.filter((o) => o.status === 'scheduled' || o.status === 'in_progress')
  const enSitio = ordenes.filter((o) => o.status === 'in_progress').length
  const ahora = new Date()
  const qs = ctx.demoQs
  const cuando = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

  return (
    <Shell {...shell} activePath="/servicio-en-campo">
      <div className="space-y-5">
        <PageHeader
          icon="handyman"
          title={soloMias ? 'Mis órdenes de servicio' : 'Servicio en campo'}
          description={
            soloMias
              ? 'Las visitas que tienes asignadas. Al llegar, marca que llegaste; la orden se cierra con los pasos obligatorios marcados y el nombre de quien recibe.'
              : 'Las visitas a casa o negocio del cliente: qué hay que hacer, quién va y cuándo. Una orden no se cierra sin los pasos obligatorios marcados ni sin el nombre de quien recibió.'
          }
        />

        <section
          aria-label="Resumen"
          className={`grid grid-cols-2 gap-3 ${soloMias ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}
        >
          <StatCard
            label="Órdenes abiertas"
            value={String(abiertas.length)}
            hint="agendadas o en sitio"
          />
          <StatCard
            label="En sitio ahora"
            value={String(enSitio)}
            hint={soloMias ? 'visitas empezadas' : 'técnicos trabajando'}
          />
          {/* Al técnico solo le salen sus órdenes: "sin técnico" no le dice nada. */}
          {!soloMias && (
            <StatCard
              label="Sin técnico"
              value={String(
                ordenes.filter(
                  (o) => o.tecnico === null && o.status !== 'done' && o.status !== 'cancelled',
                ).length,
              )}
              hint="falta asignar quién va"
            />
          )}
          <StatCard
            label="Terminadas"
            value={String(ordenes.filter((o) => o.status === 'done').length)}
            hint="con su firma"
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Órdenes de servicio</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {ordenes.length === 0 ? (
              <EmptyState
                icon="handyman"
                title={
                  soloMias ? 'No tienes órdenes asignadas' : 'Todavía no hay órdenes de servicio'
                }
                description={
                  soloMias
                    ? 'Cuando te asignen una visita aparece aquí, con la dirección, lo que hay que hacer y su lista de pasos.'
                    : 'Crea la primera abajo y agrégale sus pasos: eso es lo que después prueba que la visita ocurrió.'
                }
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Orden</TH>
                    <TH>Cliente</TH>
                    <TH>Trabajo</TH>
                    {!soloMias && <TH>Técnico</TH>}
                    <TH>Agendada</TH>
                    <TH numeric>Días abierta</TH>
                    <TH>Estado</TH>
                  </TR>
                </THead>
                <TBody>
                  {ordenes.map((o) => (
                    <TR key={o.id}>
                      <TD className="whitespace-nowrap text-[var(--color-text-primary)]">
                        <a
                          href={`/servicio-en-campo/${o.id}${qs}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {o.code}
                        </a>
                        {o.priority !== 'normal' && (
                          <span className="block text-xs text-[var(--color-text-muted)]">
                            {PRIORIDAD_ORDEN[o.priority] ?? o.priority}
                          </span>
                        )}
                      </TD>
                      <TD>{o.customer_name}</TD>
                      <TD className="max-w-72">
                        <span className="line-clamp-2 text-[var(--color-text-secondary)]">
                          {o.description}
                        </span>
                        {o.address && (
                          <span className="block truncate text-xs text-[var(--color-text-muted)]">
                            {o.address}
                          </span>
                        )}
                      </TD>
                      {!soloMias && (
                        <TD>
                          {o.tecnico ?? (
                            <span className="text-[var(--color-semantic-text-warning)]">
                              Sin asignar
                            </span>
                          )}
                        </TD>
                      )}
                      <TD className="whitespace-nowrap text-[var(--color-text-muted)]">
                        {o.scheduled_at === null ? 'Sin fecha' : cuando(o.scheduled_at)}
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {o.status === 'done' || o.status === 'cancelled'
                            ? '—'
                            : diasOrdenAbierta(new Date(o.created_at), ahora)}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={tonoEstado(o.status)}>
                          {ESTADO_ORDEN[o.status] ?? o.status}
                        </Badge>
                        {Number(o.pasos_pendientes) > 0 &&
                          o.status !== 'done' &&
                          o.status !== 'cancelled' && (
                            <span className="block pt-1 text-xs whitespace-nowrap text-[var(--color-text-muted)]">
                              {o.pasos_pendientes} paso{Number(o.pasos_pendientes) === 1 ? '' : 's'}{' '}
                              sin marcar
                            </span>
                          )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {puedeGestionar && clientes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva orden de servicio</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearOrdenForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente
                  <select name="customerId" required className={inputClase}>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Qué hay que hacer
                  <input
                    name="description"
                    required
                    className={inputClase}
                    placeholder="Mantenimiento de aire acondicionado"
                  />
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Dirección
                  <input
                    name="address"
                    className={inputClase}
                    placeholder="Calle Duarte 45, Santiago"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Prioridad
                  <select name="priority" defaultValue="normal" className={inputClase}>
                    {Object.entries(PRIORIDAD_ORDEN).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Agendar para (opcional)
                  <input type="datetime-local" name="scheduledAt" className={inputClase} />
                </label>
                <label className="flex min-w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Técnico (opcional)
                  <select name="technicianId" defaultValue="" className={inputClase}>
                    <option value="">Asignar después</option>
                    {tecnicos.map((t) => (
                      <option key={t.user_id} value={t.user_id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio className={botonClase}>
                  <Icon name="add" size={14} />
                  Crear orden
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
