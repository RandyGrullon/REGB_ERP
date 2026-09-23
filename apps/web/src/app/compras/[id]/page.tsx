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
import { costVariance, pendingReceipt } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADOS } from '../estados'
import {
  agregarLineaForm,
  cancelarOrdenForm,
  confirmarOrdenForm,
  quitarLineaForm,
  recibirLineaForm,
} from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface OrderHead {
  id: string
  number: string
  status: string
  order_date: string
  supplier_name: string
  supplier_terms: number
  warehouse_id: string
  warehouse_name: string
  subtotal: string
  discount: string
  tax: string
  total: string
}

interface LineRow {
  id: string
  product_id: string
  sku: string
  name: string
  unit: string
  qty_ordered: string
  qty_received: string
  unit_cost: string
  discount_pct: string
  line_total: string
  /** Promedio ponderado de lo que de verdad se declaro al recibir. Null si
   * todavia no ha llegado nada — no hay con que comparar. */
  received_cost: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** Ficha de la orden de compra: aqui se confirma y se recibe. */
export default async function OrdenDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'purchase-orders')

  const [head, lines, products] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OrderHead[]>`
      select po.id, po.number, po.status, po.order_date::text,
             s.name as supplier_name, s.payment_terms as supplier_terms,
             po.warehouse_id, w.name as warehouse_name,
             po.subtotal::text, po.discount::text, po.tax::text, po.total::text
      from public.purchase_orders po
      join public.suppliers s on s.id = po.supplier_id
      join public.warehouses w on w.id = po.warehouse_id
      where po.id = ${id} and po.tenant_id = ${ctx.tenantId}`
    if (!h) return [null, [], []] as const

    const l = await tx<LineRow[]>`
      select l.id, l.product_id, p.sku, p.name, p.unit,
             l.qty_ordered::text, l.qty_received::text,
             l.unit_cost::text, l.discount_pct::text, l.line_total::text,
             (select (sum(m.qty * m.unit_cost) / nullif(sum(m.qty), 0))::text
                from public.inventory_movements m
                where m.reference_type = 'purchase_order' and m.reference_id = l.order_id
                  and m.product_id = l.product_id) as received_cost
      from public.purchase_order_lines l
      join public.products p on p.id = l.product_id
      where l.order_id = ${id} and l.tenant_id = ${ctx.tenantId}
      order by p.name`

    const p =
      h.status === 'draft'
        ? await tx<{ id: string; sku: string; name: string; cost: string }[]>`
            select id, sku, name, cost::text from public.products
            where tenant_id = ${ctx.tenantId} and active order by name limit 300`
        : []
    return [h, l, p] as const
  })

  if (!head) notFound()

  const e = ESTADOS[head.status] ?? { label: head.status, tone: 'neutral' as const }
  const enBorrador = head.status === 'draft'
  const cancelado = head.status === 'cancelled'

  const puedeEditar = exigir(ctx, 'purchase-orders', 'purchase-orders.edit').ok
  const puedeConfirmar = exigir(ctx, 'purchase-orders', 'purchase-orders.confirm').ok
  const puedeRecibir = exigir(ctx, 'purchase-orders', 'purchase-orders.receive').ok
  const puedeCancelar = exigir(ctx, 'purchase-orders', 'purchase-orders.cancel').ok
  const qs = ctx.demoQs

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="orderId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/compras">
      <div className="space-y-5">
        <PageHeader
          icon="local_shipping"
          title={head.number}
          description={`${head.supplier_name} · recibe en ${head.warehouse_name}`}
          crumbs={[{ label: 'Compras', href: `/compras${qs}` }, { label: head.number }]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={e.tone}>{e.label}</Badge>
              <span className="text-xs text-[var(--color-text-muted)]">
                {head.supplier_terms === 0
                  ? 'Proveedor de contado'
                  : `${head.supplier_terms} dias de credito del proveedor`}
              </span>
            </div>
          }
          actions={
            <>
              {enBorrador && puedeConfirmar && lines.length > 0 && (
                <form action={confirmarOrdenForm}>
                  {campos}
                  <BotonEnvio
                    
                    title="No mueve inventario: es la promesa del proveedor"
                    className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                    <Icon name="check_circle" size={18} />
                    Confirmar orden
                  </BotonEnvio>
                </form>
              )}
              {!cancelado && puedeCancelar && (
                <form action={cancelarOrdenForm}>
                  {campos}
                  <BotonEnvio
                    
                    title="Lo ya recibido no se revierte."
                    className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-semantic-text-danger)] transition-colors hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                    <Icon name="cancel" size={18} />
                    Cancelar
                  </BotonEnvio>
                </form>
              )}
            </>
          }
        />

        <section aria-label="Totales" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Subtotal" value={`RD$ ${money(Number(head.subtotal))}`} hint="sin ITBIS" />
          <StatCard
            label="Descuento"
            value={`RD$ ${money(Number(head.discount))}`}
            hint="del proveedor"
          />
          <StatCard label="ITBIS" value={`RD$ ${money(Number(head.tax))}`} hint="impuesto" />
          <StatCard label="Total" value={`RD$ ${money(Number(head.total))}`} hint="comprometido" />
        </section>

        {lines.length === 0 ? (
          <Card>
            <CardBody className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              Esta orden no tiene lineas todavia. Agrega productos abajo.
            </CardBody>
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH numeric>Pedido</TH>
                <TH numeric>Recibido</TH>
                <TH numeric>Costo cotizado</TH>
                <TH numeric>Total</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {lines.map((l) => {
                const estado = { qtyOrdered: Number(l.qty_ordered), qtyReceived: Number(l.qty_received) }
                const pendiente = pendingReceipt(estado)
                const variacion =
                  l.received_cost !== null
                    ? costVariance(Number(l.unit_cost), Number(l.received_cost))
                    : null
                return (
                  <TR key={l.id}>
                    <TD>
                      <Mono>{l.sku}</Mono>{' '}
                      <span className="font-medium text-[var(--color-text-primary)]">{l.name}</span>
                      {pendiente > 0 && !enBorrador && !cancelado && (
                        <Badge tone="info" dot={false} className="ml-2">
                          faltan {pendiente}
                        </Badge>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular">
                        {estado.qtyOrdered} {l.unit}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-success)]">
                        {estado.qtyReceived}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(l.unit_cost))}</span>
                      {Number(l.discount_pct) > 0 && (
                        <span className="block text-[10px] text-[var(--color-semantic-text-warning)]">
                          -{l.discount_pct}%
                        </span>
                      )}
                      {variacion && Math.abs(variacion.porcentaje) >= 0.001 && (
                        <span
                          title={`Recibido a RD$ ${money(Number(l.received_cost))}, no al cotizado`}
                          className={`block text-[10px] ${
                            variacion.diferencia > 0
                              ? 'text-[var(--color-semantic-text-danger)]'
                              : 'text-[var(--color-semantic-text-success)]'
                          }`}
                        >
                          {variacion.diferencia > 0 ? '+' : ''}
                          {(variacion.porcentaje * 100).toFixed(1)}% al recibir
                        </span>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(l.line_total))}</span>
                    </TD>
                    <TD>
                      {enBorrador && puedeEditar && (
                        <form action={quitarLineaForm} className="inline">
                          {campos}
                          <input type="hidden" name="lineId" value={l.id} />
                          <BotonEnvio
                            
                            aria-label={`Quitar ${l.name}`}
                            className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]">
                            <Icon name="delete" size={16} />
                          </BotonEnvio>
                        </form>
                      )}
                      {!enBorrador && !cancelado && pendiente > 0 && puedeRecibir && (
                        <form action={recibirLineaForm} className="flex flex-wrap items-center gap-1">
                          {campos}
                          <input type="hidden" name="lineId" value={l.id} />
                          <input
                            name="qty"
                            defaultValue={String(pendiente)}
                            inputMode="decimal"
                            aria-label={`Cantidad a recibir de ${l.name}`}
                            className="h-8 w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                          />
                          <input
                            name="unitCost"
                            placeholder={l.unit_cost}
                            title="Costo real de esta entrega. Vacio = el cotizado."
                            inputMode="decimal"
                            aria-label={`Costo real de ${l.name}`}
                            className="h-8 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                          />
                          <BotonEnvio
                            
                            className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]">
                            Recibir
                          </BotonEnvio>
                        </form>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {enBorrador && puedeEditar && products.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Agregar producto</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={agregarLineaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto
                  <select
                    name="productId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name} (ultimo costo RD$ {money(Number(p.cost))})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input
                    name="qty"
                    required
                    inputMode="decimal"
                    defaultValue="1"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Costo cotizado
                  <input
                    name="unitCost"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descuento %
                  <input
                    name="discountPct"
                    inputMode="decimal"
                    defaultValue="0"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Agregar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                El costo lo escribes tu: es lo que este proveedor te esta cobrando ahora, no lo que
                dice el catalogo. Al recibir puedes declarar un costo distinto si llego a otro
                precio — el promedio del inventario usa el real de entrada, no el cotizado.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
