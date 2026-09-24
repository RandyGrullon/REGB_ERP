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
import { situacionDeCredito, type SituacionDeCredito } from '@/lib/credito'
import { EstadoDeCredito } from '@/components/EstadoDeCredito'
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
import { facturarPedidoForm } from '../../cobrar/actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface OrderHead {
  id: string
  number: string
  status: string
  order_date: string
  customer_id: string
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
  tax_rate: string
  line_total: string
  disponible: string
  facturado: string
  tracks_stock: boolean
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Cantidades sin ceros de relleno: "55", no "55.000". */
const cant = (raw: string | number) =>
  Number(raw).toLocaleString('es-DO', { maximumFractionDigits: 3 })

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

  const [head, lines, products, credito, facturas] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [h] = await tx<OrderHead[]>`
      select so.id, so.number, so.status, so.order_date::text,
             so.customer_id, c.name as customer_name, c.payment_terms as customer_terms,
             so.warehouse_id, w.name as warehouse_name,
             so.subtotal::text, so.discount::text, so.tax::text, so.total::text
      from public.sales_orders so
      join public.customers c on c.id = so.customer_id
      join public.warehouses w on w.id = so.warehouse_id
      where so.id = ${id} and so.tenant_id = ${ctx.tenantId}`
      if (!h) return [null, [], [], null, []] as const

      const l = await tx<LineRow[]>`
      select l.id, l.product_id, p.sku, p.name, p.unit,
             l.qty_ordered::text, l.qty_reserved::text, l.qty_delivered::text,
             l.unit_price::text, l.discount_pct::text, l.tax_rate::text, l.line_total::text,
             coalesce(sl.qty_on_hand - sl.qty_reserved, 0)::text as disponible,
             p.tracks_stock,
             -- Lo ya facturado de la linea (sin cuentas por cobrar, la RLS lo deja en 0).
             coalesce((select sum(il.qty) from public.customer_invoice_lines il
                        join public.customer_invoices i on i.id = il.invoice_id
                        where il.order_line_id = l.id and i.status <> 'void'), 0)::text
               as facturado
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

      // El credito se mira ANTES de confirmar, con los mismos numeros que
      // usara la accion: si aqui dice bloqueado, confirmar dice lo mismo.
      // Sin `ar` la RLS deja la cartera vacia y no hay vencidas que mirar.
      const s: SituacionDeCredito | null =
        h.status === 'draft' && l.length > 0
          ? await situacionDeCredito(tx, ctx.tenantId, h.customer_id, {
              excluirPedido: h.id,
              montoDocumento: Number(h.total),
            })
          : null

      const f = await tx<
        {
          id: string
          number: string
          total: string
          status: string
          ncf: string | null
          sin_lineas: boolean
        }[]
      >`
      select i.id, i.number, i.total::text, i.status, i.ncf,
             not exists (select 1 from public.customer_invoice_lines il
                         where il.invoice_id = i.id) as sin_lineas
      from public.customer_invoices i
      where i.tenant_id = ${ctx.tenantId} and i.source_type = 'sales_order' and i.source_id = ${id}
      order by i.created_at`
      return [h, l, p, s, f] as const
    },
  )

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
  // Autorizar credito es de `ar`, con el monto: un tope de rol tambien aplica.
  const puedeAutorizar = exigir(ctx, 'ar', 'ar.credit.override', Number(head.total)).ok
  const bloqueado = credito !== null && !credito.allowed
  const entregado = head.status === 'delivered'
  const aMedias = head.status === 'partially_delivered'
  const qs = ctx.demoQs

  // Lo entregado que todavia no se factura. Se factura desde aqui mismo:
  // antes, tras entregar, habia que ir a Por cobrar a buscar el pedido.
  // Una factura vieja (sin lineas) cubrio el pedido entero.
  const facturaVieja = facturas.some((f) => f.status !== 'void' && f.sin_lineas)
  const porFacturar = facturaVieja
    ? 0
    : Math.round(
        lines.reduce(
          (a, l) =>
            a +
            Math.max(0, Number(l.qty_delivered) - Number(l.facturado)) *
              Number(l.unit_price) *
              (1 - Number(l.discount_pct) / 100) *
              (1 + Number(l.tax_rate)),
          0,
        ) * 100,
      ) / 100
  const puedeFacturar = exigir(ctx, 'ar', 'ar.invoice.create').ok

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
                  : `${head.customer_terms} días de crédito`}
              </span>
              <a
                href={`/pedidos/clientes/${head.customer_id}${qs}`}
                className="text-xs text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                Ficha del cliente
              </a>
            </div>
          }
          actions={
            <>
              {enBorrador && puedeConfirmar && lines.length > 0 && !bloqueado && (
                <form action={confirmarPedidoForm}>
                  {campos}
                  <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                    <Icon name="check_circle" size={18} />
                    Confirmar y apartar
                  </BotonEnvio>
                </form>
              )}
              {porFacturar > 0 && puedeFacturar && (
                <form action={facturarPedidoForm}>
                  {campos}
                  <BotonEnvio
                    title="Emite la factura de lo entregado que falta por facturar. El comprobante (B01 o B02) sale del RNC del cliente."
                    className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                  >
                    <Icon name="receipt_long" size={18} />
                    Facturar lo entregado · RD$ {money(porFacturar)}
                  </BotonEnvio>
                </form>
              )}
              {/* Entregado completo no se cancela: la devolucion es una nota
                  de crédito sobre la factura. A medias, se cancela lo
                  pendiente y lo entregado sigue por facturar. */}
              {!cancelado && !entregado && puedeCancelar && (
                <form action={cancelarPedidoForm}>
                  {campos}
                  <BotonEnvio
                    title={
                      aMedias
                        ? 'Cancela lo que falta por entregar y devuelve lo apartado. Lo entregado queda por facturar.'
                        : 'Devuelve lo apartado al almacén.'
                    }
                    className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-semantic-text-danger)] transition-colors hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                  >
                    <Icon name="cancel" size={18} />
                    {aMedias ? 'Cancelar lo pendiente' : 'Cancelar'}
                  </BotonEnvio>
                </form>
              )}
            </>
          }
        />

        {credito && (
          <EstadoDeCredito s={credito}>
            {bloqueado && puedeConfirmar && puedeAutorizar && (
              <form action={confirmarPedidoForm} className="space-y-2">
                {campos}
                <input type="hidden" name="creditOverride" value="1" />
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Motivo de la excepcion (queda escrito con tu nombre)
                  <textarea
                    name="overrideReason"
                    required
                    minLength={4}
                    rows={2}
                    placeholder="Ej.: cliente de 10 anos, paga el viernes con cheque"
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="verified_user" size={18} />
                  Confirmar con excepcion
                </BotonEnvio>
              </form>
            )}
            {bloqueado && puedeConfirmar && !puedeAutorizar && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Para confirmarlo hace falta que el dueño, o quien autoriza crédito, lo apruebe con
                una excepcion.
              </p>
            )}
          </EstadoDeCredito>
        )}

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
              Este pedido no tiene líneas todavía. Agrega productos abajo.
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
                // Se entrega lo que existe: lo apartado para esta linea mas lo
                // libre del almacen. Un servicio no lleva existencia.
                const entregable = l.tracks_stock
                  ? Math.min(pendiente, estado.qtyReserved + Math.max(0, Number(l.disponible)))
                  : pendiente
                return (
                  <TR key={l.id}>
                    <TD>
                      <Mono>{l.sku}</Mono>{' '}
                      <span className="font-medium text-[var(--color-text-primary)]">{l.name}</span>
                      {falta > 0 && !enBorrador && (
                        <Badge tone="warning" dot={false} className="ml-2">
                          faltan {cant(falta)}
                        </Badge>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular">
                        {cant(estado.qtyOrdered)} {l.unit}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-info)]">
                        {cant(estado.qtyReserved)}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-success)]">
                        {cant(estado.qtyDelivered)}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">
                        {cant(l.disponible)}
                      </span>
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
                            className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]"
                          >
                            <Icon name="delete" size={16} />
                          </BotonEnvio>
                        </form>
                      )}
                      {!enBorrador &&
                        !cancelado &&
                        pendiente > 0 &&
                        puedeEntregar &&
                        entregable <= 0 && (
                          <span className="text-xs text-[var(--color-text-muted)]">
                            Sin existencia para entregar
                          </span>
                        )}
                      {!enBorrador && !cancelado && entregable > 0 && puedeEntregar && (
                        <form action={entregarLineaForm} className="flex items-center gap-1">
                          {campos}
                          <input type="hidden" name="lineId" value={l.id} />
                          <input
                            name="qty"
                            defaultValue={String(entregable)}
                            inputMode="decimal"
                            aria-label={`Cantidad a entregar de ${l.name}`}
                            className="h-8 w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                          />
                          <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]">
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

        {facturas.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Facturas de este pedido</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-[var(--color-border)]">
                {facturas.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <a
                      href={`/cobrar/${f.id}${qs}`}
                      className="font-semibold text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                    >
                      <Mono>{f.number}</Mono>
                    </a>
                    <span className="text-[var(--color-text-muted)]">{f.ncf ?? 'sin NCF'}</span>
                    <span className="tabular ml-auto font-semibold text-[var(--color-text-primary)]">
                      RD$ {money(Number(f.total))}
                    </span>
                    {f.status === 'void' && <Badge tone="neutral">Anulada</Badge>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Se factura lo entregado: si el pedido sale por partes, cada entrega se factura
                aparte.
              </p>
            </CardBody>
          </Card>
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
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Agregar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                El precio sale de la lista de precios del cliente (segun la cantidad); si no tiene
                lista, del catálogo, que es el que ves entre parentesis. Al confirmar se aparta lo
                que haya; lo que falte queda en backorder y se entrega cuando entre mercancia.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
