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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { agregarParteForm, transicionarOrdenForm } from '../../actions'
import { ESTADO_ORDEN, PRIORIDAD_ORDEN, TIPO_ORDEN } from '../../estados'

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
}

interface ParteRow {
  id: string
  sku: string
  name: string
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
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const fecha = (iso: string) => new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
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
             wo.type, wo.status, wo.priority, wo.description, wo.notes, wo.opened_at::text
      from public.work_orders wo
      join public.equipment e on e.id = wo.equipment_id
      where wo.id = ${id} and wo.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, partes: [], productos: [] }

    const p = await tx<ParteRow[]>`
      select wop.id, pr.sku, pr.name, wop.qty_used::text
      from public.work_order_parts wop
      join public.products pr on pr.id = wop.product_id
      where wop.work_order_id = ${id} and wop.tenant_id = ${ctx.tenantId}`

    const prod =
      h.status === 'open' || h.status === 'in_progress'
        ? await tx<ProductoOption[]>`
            select id, sku, name from public.products
            where tenant_id = ${ctx.tenantId} and active order by name limit 300`
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
          crumbs={[{ label: 'Mantenimiento', href: `/mantenimiento${qs}` }, { label: 'Orden' }]}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{PRIORIDAD_ORDEN[head.priority] ?? head.priority}</Badge>
              <Badge tone={badgeEstado(head.status)}>{ESTADO_ORDEN[head.status] ?? head.status}</Badge>
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Equipo"
            value={`${head.equipment_code} · ${head.equipment_name}`}
          />
          <StatCard label="Tipo" value={TIPO_ORDEN[head.type] ?? head.type} />
          <StatCard label="Abierta" value={fecha(head.opened_at)} />
        </section>

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
                <button type="submit" className={botonClase}>
                  <Icon name="play_arrow" size={14} />
                  Empezar a trabajar
                </button>
              </form>
            )}
            {head.status === 'in_progress' && (
              <form action={transicionarOrdenForm}>
                {campos}
                <input type="hidden" name="siguiente" value="completed" />
                <button type="submit" className={botonClase}>
                  <Icon name="check_circle" size={14} />
                  Completar
                </button>
              </form>
            )}
            <form action={transicionarOrdenForm}>
              {campos}
              <input type="hidden" name="siguiente" value="cancelled" />
              <button type="submit" className={botonSecundarioClase}>
                Cancelar
              </button>
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
                  Todavia no se ha registrado ningun repuesto.
                </TD>
              </TR>
            ) : (
              partes.map((p) => (
                <TR key={p.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    {p.sku} — {p.name}
                  </TD>
                  <TD numeric>
                    <span className="tabular">{p.qty_used}</span>
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
                Queda registrado contra el producto -no descuenta el inventario automaticamente-.
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
                  <input name="qtyUsed" required inputMode="decimal" className={`tabular ${claseInput}`} />
                </label>
                <button type="submit" className={botonClase}>
                  <Icon name="add" size={14} />
                  Registrar
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
