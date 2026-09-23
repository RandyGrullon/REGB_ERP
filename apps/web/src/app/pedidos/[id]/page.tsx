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
import { hasBackorder, pendingDelivery } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADOS } from '../estados'
import {
  agregarLineaForm,
  cancelarPedidoForm,
  confirmarPedidoForm,
  entregarLineaForm,
  quitarLineaForm,
} from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface OrderHead {
  id: string
  number: string
  status: string
  order_date: string
  customer_name: string
  customer_terms: number
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
  qty_reserved: string
  qty_delivered: string
  unit_price: string
  discount_pct: string
  line_total: string
  disponible: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ficha del pedido (S20): aqui se confirma (aparta) y se entrega (saca). */
export default async function PedidoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'sales-orders')

  const [head, lines, products] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OrderHead[]>`
      select so.id, so.number, so.status, so.order_date::text,
             c.name as customer_name, c.payment_terms as customer_terms,
             so.warehouse_id, w.name as warehouse_name,
             so.subtotal::text, so.discount::text, so.tax::text, so.total::text
      from public.sales_orders so
      join public.customers c on c.id = so.customer_id
      join public.warehouses w on w.id = so.warehouse_id
      where so.id = ${id} and so.tenant_id = ${ctx.tenantId}`
    if (!h) return [null, [], []] as const

    const l = await tx<LineRow[]>`
      select l.id, l.product_id, p.sku, p.name, p.unit,
             l.qty_ordered::text, l.qty_reserved::text, l.qty_delivered::text,
             l.unit_price::text, l.discount_pct::text, l.line_total::text,
             coalesce(sl.qty_on_hand - sl.qty_reserved, 0)::text as disponible
      from public.sales_order_lines l
      join public.products p on p.id = l.product_id
      left join public.stock_levels sl
        on sl.product_id = l.product_id and sl.warehouse_id = ${h.warehouse_id}
       and sl.tenant_id = ${ctx.tenantId}
      where l.order_id = ${id} and l.tenant_id = ${ctx.tenantId}
      order by p.name`

    const p =
      h.status === 'draft'
        ? await tx<{ id: string; sku: string; name: string; price: string }[]>`
            select id, sku, name, price::text from public.products
            where tenant_id = ${ctx.tenantId} and active order by name limit 300`
        : []
    return [h, l, p] as const
  })

  if (!head) notFound()

  const estadoLineas = lines.map((l) => ({
    qtyOrdered: Number(l.qty_ordered),
    qtyReserved: Number(l.qty_reserved),
    qtyDelivered: Number(l.qty_delivered),
  }))

  const e = ESTADOS[head.status] ?? { label: head.status, tone: 'neutral' as const }
  const enBorrador = head.status === 'draft'
  const cancelado = head.status === 'cancelled'
  const backorder = hasBackorder(estadoLineas) && !enBorrador && !cancelado

  const puedeEditar = exigir(ctx, 'sales-orders', 'sales-orders.edit').ok
  const puedeConfirmar = exigir(ctx, 'sales-orders', 'sales-orders.confirm').ok
  const puedeEntregar = exigir(ctx, 'sales-orders', 'sales-orders.deliver').ok
  const puedeCancelar = exigir(ctx, 'sales-orders', 'sales-orders.cancel').ok
  const qs = ctx.demoQs

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="orderId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/pedidos">
      <div className="space-y-5">
        <PageHeader
          icon="receipt_long"
          title={head.number}
          description={`${head.customer_name} · despacha ${head.warehouse_name}`}
          crumbs={[{ label: 'Pedidos', href: `/pedidos${qs}` }, { label: head.number }]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={e.tone}>{e.label}</Badge>
              {backorder && (
                <Badge tone="warning" title="Hay lineas sin existencia suficiente">
                  con backorder
                </Badge>
              )}
              <span className="text-xs text-[var(--color-text-muted)]">
                {head.customer_terms === 0
                  ? 'Cliente de contado'
                  : `${head.customer_terms} dias de credito`}
              </span>
            </div>
          }
          actions={
            <>
              {enBorrador && puedeConfirmar && lines.length > 0 && (
                <form action={confirmarPedidoForm}>
                  {campos}
                  <BotonEnvio
                    
                    className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                    <Icon name="check_circle" size={18} />
                    Confirmar y apartar
                  </BotonEnvio>
                </form>
              )}
              {!cancelado && puedeCancelar && (
                <form action={cancelarPedidoForm}>
                  {campos}
                  <BotonEnvio
                    
                    title="Devuelve lo apartado al almacen. Lo ya entregado no se revierte."
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
          <StatCard
            label="Subtotal"
            value={`RD$ ${money(Number(head.subtotal))}`}
            hint="sin ITBIS"
          />
          <StatCard
            label="Descuento"
            value={`RD$ ${money(Number(head.discount))}`}
            hint="aplicado"
          />
          <StatCard label="ITBIS" value={`RD$ ${money(Number(head.tax))}`} hint="impuesto" />
          <StatCard label="Total" value={`RD$ ${money(Number(head.total))}`} hint="a cobrar" />
        </section>

        {lines.length === 0 ? (
          <Card>
            <CardBody className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              Este pedido no tiene lineas todavia. Agrega productos abajo.
            </CardBody>
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH numeric>Pedido</TH>
                <TH numeric>Apartado</TH>
                <TH numeric>Entregado</TH>
                <TH numeric>Disponible</TH>
                <TH numeric>Precio</TH>
                <TH numeric>Total</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {lines.map((l) => {
                const estado = {
                  qtyOrdered: Number(l.qty_ordered),
                  qtyReserved: Number(l.qty_reserved),
                  qtyDelivered: Number(l.qty_delivered),
                }
                const pendiente = pendingDelivery(estado)
                const falta = estado.qtyOrdered - estado.qtyReserved - estado.qtyDelivered
                return (
                  <TR key={l.id}>
                    <TD>
                      <Mono>{l.sku}</Mono>{' '}
                      <span className="font-medium text-[var(--color-text-primary)]">{l.name}</span>
                      {falta > 0 && !enBorrador && (
                        <Badge tone="warning" dot={false} className="ml-2">
                          faltan {falta}
                        </Badge>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular">
                        {estado.qtyOrdered} {l.unit}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-info)]">
                        {estado.qtyReserved}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-success)]">
                        {estado.qtyDelivered}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">{l.disponible}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(l.unit_price))}</span>
                      {Number(l.discount_pct) > 0 && (
                        <span className="block text-[10px] text-[var(--color-semantic-text-warning)]">
                          -{l.discount_pct}%
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
                      {!enBorrador && !cancelado && pendiente > 0 && puedeEntregar && (
                        <form action={entregarLineaForm} className="flex items-center gap-1">
                          {campos}
                          <input type="hidden" name="lineId" value={l.id} />
                          <input
                            name="qty"
                            defaultValue={String(
                              Math.min(pendiente, estado.qtyReserved) || pendiente,
                            )}
                            inputMode="decimal"
                            aria-label={`Cantidad a entregar de ${l.name}`}
                            className="h-8 w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                          />
                          <BotonEnvio
                            
                            className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]">
                            Entregar
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
                        {p.sku} — {p.name} (RD$ {money(Number(p.price))})
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
                {exigir(ctx, 'sales-orders', 'sales-orders.discount').ok && (
                  <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Descuento %
                    <input
                      name="discountPct"
                      inputMode="decimal"
                      defaultValue="0"
                      className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                    />
                  </label>
                )}
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Agregar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                El precio sale del catalogo. Al confirmar se aparta lo que haya; lo que falte queda
                en backorder y se puede entregar despues.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
