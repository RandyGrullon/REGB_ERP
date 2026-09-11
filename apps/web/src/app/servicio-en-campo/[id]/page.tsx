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
} from '@regb/ui'
import {
  avanceChecklist,
  costoRepuestos,
  minutosEnSitio,
  motivoNoCierre,
  type EstadoOrdenServicio,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  agregarPasoForm,
  alternarPasoForm,
  registrarRepuestoForm,
  transicionarOrdenForm,
} from '../actions'
import { ESTADO_ORDEN, PRIORIDAD_ORDEN } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface OrdenHead {
  id: string
  code: string
  customer_name: string
  status: EstadoOrdenServicio
  priority: string
  description: string
  address: string | null
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  signed_by: string | null
  signed_at: string | null
}

interface Paso {
  id: string
  label: string
  required: boolean
  done: boolean
  done_at: string | null
}

interface Repuesto {
  id: string
  description: string
  qty: string
  unit_cost: string
  product_name: string | null
}

interface ProductoOption {
  id: string
  name: string
  sku: string
  cost: string | null
}

const inputClase =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const money = (n: number) => `RD$${n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const tonoEstado = (s: EstadoOrdenServicio): 'success' | 'danger' | 'warning' | 'info' | 'neutral' => {
  if (s === 'done') return 'success'
  if (s === 'cancelled') return 'danger'
  if (s === 'in_progress') return 'info'
  if (s === 'scheduled') return 'warning'
  return 'neutral'
}

/**
 * Detalle de una orden de servicio (modulo 74).
 *
 * Es la pantalla que el tecnico abre en el telefono parado en la casa
 * del cliente: el checklist va primero, la firma va al final, y el
 * motivo por el que todavia no se puede cerrar se dice a la cara en vez
 * de esconder el boton.
 */
export default async function OrdenServicioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'field-service')

  const { head, pasos, repuestos, productos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OrdenHead[]>`
      select so.id, so.code, c.name as customer_name, so.status, so.priority, so.description,
             so.address, so.scheduled_at::text, so.started_at::text, so.completed_at::text,
             so.signed_by, so.signed_at::text
      from public.service_orders so
      join public.customers c on c.id = so.customer_id
      where so.id = ${id} and so.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, pasos: [], repuestos: [], productos: [] }

    const p = await tx<Paso[]>`
      select id, label, required, done, done_at::text
      from public.service_checklist_items
      where tenant_id = ${ctx.tenantId} and order_id = ${id}
      order by position, created_at`

    const r = await tx<Repuesto[]>`
      select sp.id, sp.description, sp.qty::text, sp.unit_cost::text, pr.name as product_name
      from public.service_parts sp
      left join public.products pr on pr.id = sp.product_id
      where sp.tenant_id = ${ctx.tenantId} and sp.order_id = ${id}
      order by sp.created_at`

    const pr = await tx<ProductoOption[]>`
      select id, name, sku, cost::text from public.products
      where tenant_id = ${ctx.tenantId} and active order by name limit 300`

    return { head: h, pasos: p, repuestos: r, productos: pr }
  })

  if (!head) notFound()

  const terminada = head.status === 'done' || head.status === 'cancelled'
  const hechos = pasos.filter((p) => p.done).length
  const avance = avanceChecklist(hechos, pasos.length)
  const costo = costoRepuestos(repuestos.map((r) => ({ qty: Number(r.qty), unitCost: Number(r.unit_cost) })))
  const minutos =
    head.started_at === null
      ? null
      : minutosEnSitio(new Date(head.started_at), head.completed_at === null ? null : new Date(head.completed_at))
  // El mismo calculo que la accion: aqui es para EXPLICAR, alla es para decidir.
  const faltaParaCerrar = motivoNoCierre(pasos, head.signed_by)

  const puedeEjecutar = exigir(ctx, 'field-service', 'field-service.execute').ok
  const puedeGestionar = exigir(ctx, 'field-service', 'field-service.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="orderId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/servicio-en-campo">
      <div className="space-y-5">
        <PageHeader
          icon="handyman"
          title={`${head.code} · ${head.customer_name}`}
          crumbs={[{ label: 'Servicio en campo', href: `/servicio-en-campo${qs}` }, { label: head.code }]}
          description={head.description}
          actions={<Badge tone={tonoEstado(head.status)}>{ESTADO_ORDEN[head.status] ?? head.status}</Badge>}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Checklist"
            value={avance === null ? '—' : `${(avance * 100).toFixed(0)}%`}
            hint={`${hechos} de ${pasos.length}`}
          />
          <StatCard label="Repuestos" value={money(costo)} />
          <StatCard label="Tiempo en sitio" value={minutos === null ? 'en curso' : `${minutos} min`} />
          <StatCard label="Prioridad" value={PRIORIDAD_ORDEN[head.priority] ?? head.priority} />
        </section>

        {head.address !== null && (
          <p className="text-xs text-[var(--color-text-muted)]">
            <Icon name="location_on" size={14} /> {head.address}
            {head.scheduled_at !== null && ` · agendada ${new Date(head.scheduled_at).toLocaleString('es-DO')}`}
          </p>
        )}

        {puedeEjecutar && !terminada && (
          <div className="flex flex-wrap items-center gap-2">
            {head.status === 'draft' && (
              <form action={transicionarOrdenForm}>
                {campos}
                <input type="hidden" name="siguiente" value="scheduled" />
                <BotonEnvio  className={botonClase}>
                  <Icon name="event" size={14} />
                  Agendar
                </BotonEnvio>
              </form>
            )}
            {head.status === 'scheduled' && (
              <form action={transicionarOrdenForm}>
                {campos}
                <input type="hidden" name="siguiente" value="in_progress" />
                <BotonEnvio  className={botonClase}>
                  <Icon name="play_arrow" size={14} />
                  Llegue al sitio
                </BotonEnvio>
              </form>
            )}
            <form action={transicionarOrdenForm}>
              {campos}
              <input type="hidden" name="siguiente" value="cancelled" />
              <BotonEnvio  className={botonSecundarioClase}>
                <Icon name="close" size={14} />
                Cancelar orden
              </BotonEnvio>
            </form>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
          </CardHeader>
          <CardBody>
            {pasos.length === 0 ? (
              <p className="py-2 text-xs text-[var(--color-text-muted)]">
                Esta orden todavia no tiene checklist. Sin pasos obligatorios se puede cerrar con solo la firma -pero
                entonces no queda constancia de que se reviso-.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {pasos.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p
                        className={
                          p.done
                            ? 'text-sm text-[var(--color-text-muted)] line-through'
                            : 'text-sm text-[var(--color-text-primary)]'
                        }
                      >
                        {p.label}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {p.required ? 'Obligatorio' : 'Opcional'}
                        {p.done_at !== null && ` · marcado ${new Date(p.done_at).toLocaleString('es-DO')}`}
                      </p>
                    </div>
                    {puedeEjecutar && !terminada ? (
                      <form action={alternarPasoForm}>
                        {campos}
                        <input type="hidden" name="itemId" value={p.id} />
                        <BotonEnvio
                          
                          className={p.done ? botonSecundarioClase : botonClase}
                          aria-label={p.done ? `Desmarcar ${p.label}` : `Marcar ${p.label}`}>
                          <Icon name={p.done ? 'undo' : 'check'} size={14} />
                          {p.done ? 'Desmarcar' : 'Marcar'}
                        </BotonEnvio>
                      </form>
                    ) : (
                      <Badge tone={p.done ? 'success' : 'neutral'}>{p.done ? 'Hecho' : 'Pendiente'}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {puedeGestionar && !terminada && (
              <form action={agregarPasoForm} className="mt-4 flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Paso
                  <input name="label" required className={inputClase} placeholder="Revisar presion del gas" />
                </label>
                <label className="flex items-center gap-2 pb-2 text-xs text-[var(--color-text-muted)]">
                  <input type="checkbox" name="required" defaultChecked />
                  Obligatorio para cerrar
                </label>
                <BotonEnvio  className={botonClase}>
                  <Icon name="add" size={14} />
                  Agregar paso
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Repuestos usados</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-[var(--color-border)]">
              {repuestos.length === 0 && (
                <li className="py-2 text-xs text-[var(--color-text-muted)]">Todavia no se registro ningun repuesto.</li>
              )}
              {repuestos.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--color-text-primary)]">{r.description}</p>
                    {r.product_name !== null && (
                      <p className="text-xs text-[var(--color-text-muted)]">{r.product_name}</p>
                    )}
                  </div>
                  <span className="tabular text-sm text-[var(--color-text-primary)]">
                    {r.qty} × {money(Number(r.unit_cost))}
                  </span>
                </li>
              ))}
            </ul>

            {puedeEjecutar && !terminada && (
              <form action={registrarRepuestoForm} className="mt-4 flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto (opcional)
                  <select name="productId" defaultValue="" className={inputClase}>
                    <option value="">Sin producto del catalogo</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input name="description" required className={inputClase} placeholder="Capacitor 35uF" />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input name="qty" required inputMode="decimal" defaultValue="1" className={`${inputClase} tabular`} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Costo unitario
                  <input name="unitCost" required inputMode="decimal" className={`${inputClase} tabular`} />
                </label>
                <BotonEnvio  className={botonClase}>
                  <Icon name="add" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cierre y firma</CardTitle>
          </CardHeader>
          <CardBody>
            {head.status === 'done' ? (
              <p className="py-2 text-sm text-[var(--color-text-primary)]">
                Recibido por <strong>{head.signed_by}</strong>
                {head.signed_at !== null && (
                  <span className="text-[var(--color-text-muted)]">
                    {' '}
                    el {new Date(head.signed_at).toLocaleString('es-DO')}
                  </span>
                )}
              </p>
            ) : head.status === 'in_progress' ? (
              <>
                {faltaParaCerrar !== null && pasos.some((p) => p.required && !p.done) && (
                  <p className="mb-3 text-xs text-[var(--color-semantic-text-warning)]">{faltaParaCerrar}</p>
                )}
                {puedeEjecutar && (
                  <form action={transicionarOrdenForm} className="flex flex-wrap items-end gap-3">
                    {campos}
                    <input type="hidden" name="siguiente" value="done" />
                    <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Nombre de quien recibe
                      <input name="signedBy" required className={inputClase} placeholder="Ana Rosario" />
                    </label>
                    <BotonEnvio  className={botonClase}>
                      <Icon name="draw" size={14} />
                      Cerrar con firma
                    </BotonEnvio>
                  </form>
                )}
              </>
            ) : (
              <p className="py-2 text-xs text-[var(--color-text-muted)]">
                La orden se cierra desde el sitio: primero marca que llegaste.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
