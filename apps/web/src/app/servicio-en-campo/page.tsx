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
  created_at: string
  pasos_pendientes: string
}

interface ClienteOption {
  id: string
  name: string
}

const inputClase =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'

const tonoEstado = (s: EstadoOrdenServicio): 'success' | 'danger' | 'warning' | 'info' | 'neutral' => {
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

  const { ordenes, clientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const o = await tx<Orden[]>`
      select so.id, so.code, c.name as customer_name, so.status, so.priority,
             so.scheduled_at::text, so.description, so.created_at::text,
             (select count(*) from public.service_checklist_items ci
              where ci.order_id = so.id and ci.required and not ci.done)::text as pasos_pendientes
      from public.service_orders so
      join public.customers c on c.id = so.customer_id
      where so.tenant_id = ${ctx.tenantId}
      order by
        case so.status when 'in_progress' then 0 when 'scheduled' then 1 when 'draft' then 2 else 3 end,
        so.scheduled_at nulls last, so.created_at desc`

    const c = await tx<ClienteOption[]>`
      select id, name from public.customers
      where tenant_id = ${ctx.tenantId} and is_active
      order by name limit 300`

    return { ordenes: o, clientes: c }
  })

  const abiertas = ordenes.filter((o) => o.status === 'scheduled' || o.status === 'in_progress')
  const enSitio = ordenes.filter((o) => o.status === 'in_progress').length
  const ahora = new Date()
  const puedeGestionar = exigir(ctx, 'field-service', 'field-service.manage').ok
  const qs = ctx.demoQs
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
          title="Servicio en campo"
          description="Una orden no se cierra con pasos obligatorios sin marcar ni sin la firma de quien recibio."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Ordenes abiertas" value={String(abiertas.length)} />
          <StatCard label="En sitio ahora" value={String(enSitio)} />
          <StatCard label="Terminadas" value={String(ordenes.filter((o) => o.status === 'done').length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Ordenes de servicio</CardTitle>
          </CardHeader>
          <CardBody>
            {ordenes.length === 0 ? (
              <EmptyState
                icon="handyman"
                title="Todavia no hay ordenes de servicio"
                description="Crea la primera abajo y agregale su checklist: eso es lo que despues prueba que la visita ocurrio."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Orden</TH>
                    <TH>Cliente</TH>
                    <TH>Trabajo</TH>
                    <TH>Agendada</TH>
                    <TH numeric>Dias</TH>
                    <TH>Estado</TH>
                  </TR>
                </THead>
                <TBody>
                  {ordenes.map((o) => (
                    <TR key={o.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <a href={`/servicio-en-campo/${o.id}${qs}`} className="underline-offset-2 hover:underline">
                          {o.code}
                        </a>
                        {o.priority !== 'normal' && (
                          <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                            {PRIORIDAD_ORDEN[o.priority] ?? o.priority}
                          </span>
                        )}
                      </TD>
                      <TD>{o.customer_name}</TD>
                      <TD className="max-w-64 truncate text-[var(--color-text-muted)]">{o.description}</TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {o.scheduled_at === null ? 'sin fecha' : new Date(o.scheduled_at).toLocaleString('es-DO')}
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {o.status === 'done' || o.status === 'cancelled'
                            ? '—'
                            : diasOrdenAbierta(new Date(o.created_at), ahora)}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={tonoEstado(o.status)}>{ESTADO_ORDEN[o.status] ?? o.status}</Badge>
                        {Number(o.pasos_pendientes) > 0 && o.status !== 'done' && o.status !== 'cancelled' && (
                          <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                            {o.pasos_pendientes} paso{Number(o.pasos_pendientes) === 1 ? '' : 's'} sin marcar
                          </span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && clientes.length > 0 && (
              <form action={crearOrdenForm} className="mt-4 flex flex-wrap items-end gap-3">
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
                  Que hay que hacer
                  <input name="description" required className={inputClase} placeholder="Mantenimiento de aire acondicionado" />
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Direccion
                  <input name="address" className={inputClase} placeholder="Calle Duarte 45, Santiago" />
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
                <BotonEnvio  className={botonClase}>
                  <Icon name="add" size={14} />
                  Crear orden
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
