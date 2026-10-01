import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  PageHeader,
  Mono,
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
import { agregarParteForm, transicionarOrdenForm } from '../../actions'
import { ESTADO_ORDEN, PRIORIDAD_ORDEN, TIPO_ORDEN } from '../../estados'
import { BotonEnvio } from '@/components/BotonEnvio'
import { cantidad } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'

interface OrdenHead {
  id: string
  equipment_id: string
  equipment_code: string
  equipment_name: string
  type: string
  status: string
  priority: string
  description: string
  notes: string | null
  opened_at: string
  completed_at: string | null
  pidio: string | null
}

interface ParteRow {
  id: string
  sku: string
  name: string
  unit: string
  qty_used: string
}

interface ProductoOption {
  id: string
  sku: string
  name: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
const badgeEstado = (s: string): 'success' | 'warning' | 'neutral' => {
  if (s === 'completed') return 'success'
  if (s === 'open' || s === 'in_progress') return 'warning'
  return 'neutral'
}

/** Detalle de una orden de trabajo (modulo 59): su maquina de estados y las partes usadas. */
export default async function OrdenDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'maintenance')

  const { head, partes, productos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OrdenHead[]>`
      select wo.id, wo.equipment_id, e.code as equipment_code, e.name as equipment_name,
             wo.type, wo.status, wo.priority, wo.description, wo.notes, wo.opened_at::text,
             wo.completed_at::text, up.display_name as pidio
      from public.work_orders wo
      join public.equipment e on e.id = wo.equipment_id
      left join public.user_profiles up
        on up.tenant_id = wo.tenant_id and up.user_id = wo.requested_by
      where wo.id = ${id} and wo.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, partes: [], productos: [] }

    const p = await tx<ParteRow[]>`
      select wop.id, pr.sku, pr.name, pr.unit, wop.qty_used::text
      from public.work_order_parts wop
      join public.products pr on pr.id = wop.product_id
      where wop.work_order_id = ${id} and wop.tenant_id = ${ctx.tenantId}`

    const prod =
      h.status === 'open' || h.status === 'in_progress'
        ? await tx<ProductoOption[]>`
            select id, sku, name from public.products
            where tenant_id = ${ctx.tenantId} and active and tracks_stock order by name limit 300`
        : []

    return { head: h, partes: p, productos: prod }
  })

  if (!head) notFound()

  const puedeTrabajar = exigir(ctx, 'maintenance', 'maintenance.work').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="ordenId" value={head.id} />
    </>
  )
  const enCurso = head.status === 'open' || head.status === 'in_progress'

  return (
    <Shell {...shell} activePath="/mantenimiento">
      <div className="space-y-5">
        <PageHeader
          icon="build"
          title={head.description}
          description={[
            `${TIPO_ORDEN[head.type] ?? head.type}`,
            `abierta el ${fecha(head.opened_at)}`,
            head.pidio ? `la pidió ${head.pidio}` : null,
            head.completed_at ? `completada el ${fecha(head.completed_at)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          meta={
            <a
              href={`/mantenimiento/equipos/${head.equipment_id}${qs}`}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-text-link)] hover:underline"
            >
              <Icon name="precision_manufacturing" size={14} />
              {head.equipment_code} · {head.equipment_name}
            </a>
          }
          crumbs={[
            { label: 'Mantenimiento de equipos', href: `/mantenimiento${qs}` },
            { label: 'Orden' },
          ]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  head.priority === 'urgent'
                    ? 'danger'
                    : head.priority === 'high'
                      ? 'warning'
                      : 'neutral'
                }
              >
                Prioridad {(PRIORIDAD_ORDEN[head.priority] ?? head.priority).toLowerCase()}
              </Badge>
              <Badge tone={badgeEstado(head.status)}>
                {ESTADO_ORDEN[head.status] ?? head.status}
              </Badge>
            </div>
          }
        />

        {head.notes && (
          <p className="text-xs text-[var(--color-text-muted)]">
            <Icon name="sticky_note_2" size={12} /> {head.notes}
          </p>
        )}

        {puedeTrabajar && enCurso && (
          <div className="flex gap-2">
            {head.status === 'open' && (
              <form action={transicionarOrdenForm}>
                {campos}
                <input type="hidden" name="siguiente" value="in_progress" />
                <BotonEnvio className={botonClase}>
                  <Icon name="play_arrow" size={14} />
                  Empezar a trabajar
                </BotonEnvio>
              </form>
            )}
            {head.status === 'in_progress' && (
              <form action={transicionarOrdenForm}>
                {campos}
                <input type="hidden" name="siguiente" value="completed" />
                <BotonEnvio className={botonClase}>
                  <Icon name="check_circle" size={14} />
                  Completar
                </BotonEnvio>
              </form>
            )}
            <form action={transicionarOrdenForm}>
              {campos}
              <input type="hidden" name="siguiente" value="cancelled" />
              <BotonEnvio className={botonSecundarioClase}>Cancelar</BotonEnvio>
            </form>
          </div>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Repuesto</TH>
              <TH numeric>Cantidad</TH>
            </TR>
          </THead>
          <TBody>
            {partes.length === 0 ? (
              <TR>
                <TD colSpan={2} className="text-center text-[var(--color-text-muted)]">
                  Todavía no se ha registrado ningún repuesto.
                </TD>
              </TR>
            ) : (
              partes.map((p) => (
                <TR key={p.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <Mono>{p.sku}</Mono> {p.name}
                  </TD>
                  <TD numeric>
                    <span className="tabular">{cantidad(p.qty_used, p.unit)}</span>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {puedeTrabajar && enCurso && productos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar repuesto usado</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                Queda anotado en la orden para saber qué se gastó en este equipo. La salida del
                almacén se registra aparte, con un ajuste en Existencias.
              </p>
              <form action={agregarParteForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Repuesto
                  <select name="productId" required className={claseInput}>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input
                    name="qtyUsed"
                    required
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <BotonEnvio className={botonClase}>
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
