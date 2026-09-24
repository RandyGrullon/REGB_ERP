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
import type { EstadoCotizacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  agregarLineaForm,
  convertirEnPedidoForm,
  crearVersionNuevaForm,
  quitarLineaForm,
  transicionarCotizacionForm,
} from '../actions'
import { ESTADO_COTIZACION } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface CotizacionHead {
  id: string
  quote_number: string
  version: number
  status: EstadoCotizacion
  customer_name: string | null
  terms: string | null
  valid_until: string | null
  subtotal: string
  discount: string
  tax: string
  total: string
  rejected_reason: string | null
  supersedes_id: string | null
  customer_id: string | null
  sales_order_id: string | null
  pedido: string | null
}

interface LineaRow {
  id: string
  sku: string
  name: string
  description: string | null
  quantity: string
  unit_price: string
  discount_pct: string
  line_total: string
}

interface ProductoOption {
  id: string
  sku: string
  name: string
  price: string | null
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Cantidades sin ceros de relleno: "40", no "40.0000". */
const cant = (raw: string) => Number(raw).toLocaleString('es-DO', { maximumFractionDigits: 4 })
const fecha = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'approved') return 'success'
  if (s === 'rejected' || s === 'expired') return 'danger'
  if (s === 'sent') return 'warning'
  return 'neutral'
}

/** Detalle de una cotizacion (modulo 31): lineas, maquina de estados y versiones. */
export default async function CotizacionDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'quotes')

  const { head, lineas, productos, almacenes } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [h] = await tx<CotizacionHead[]>`
      select q.id, q.quote_number, q.version, q.status, c.name as customer_name, q.terms,
             q.valid_until::text, q.subtotal::text, q.discount::text, q.tax::text, q.total::text,
             q.rejected_reason, q.supersedes_id, q.customer_id, q.sales_order_id,
             so.number as pedido
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      left join public.sales_orders so on so.id = q.sales_order_id
      where q.id = ${id} and q.tenant_id = ${ctx.tenantId}`
      if (!h) return { head: null, lineas: [], productos: [], almacenes: [] }

      const l = await tx<LineaRow[]>`
      select ql.id, p.sku, p.name, ql.description, ql.quantity::text, ql.unit_price::text,
             ql.discount_pct::text, ql.line_total::text
      from public.quote_lines ql
      join public.products p on p.id = ql.product_id
      where ql.quote_id = ${id} and ql.tenant_id = ${ctx.tenantId}
      order by p.name`

      const prod =
        h.status === 'draft'
          ? await tx<ProductoOption[]>`
            select id, sku, name, price::text from public.products
            where tenant_id = ${ctx.tenantId} and active order by name limit 300`
          : []

      // Para convertirla en pedido: de que almacen sale.
      const alm =
        h.status === 'approved' && !h.sales_order_id
          ? await tx<{ id: string; name: string }[]>`
            select id, name from public.warehouses
            where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
          : []

      return { head: h, lineas: l, productos: prod, almacenes: alm }
    },
  )

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'quotes', 'quotes.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="quoteId" value={head.id} />
    </>
  )
  const enBorrador = head.status === 'draft'
  const convertida = head.sales_order_id !== null
  const puedeRevisar = head.status !== 'draft' && head.status !== 'superseded' && !convertida
  const puedeConvertir =
    puedeGestionar &&
    head.status === 'approved' &&
    !convertida &&
    head.customer_id !== null &&
    almacenes.length > 0 &&
    exigir(ctx, 'sales-orders', 'sales-orders.create').ok
  const titulo = `${head.quote_number} · v${head.version}`

  return (
    <Shell {...shell} activePath="/cotizaciones-venta">
      <div className="space-y-5">
        <PageHeader
          icon="description"
          title={titulo}
          crumbs={[{ label: 'Cotizaciones', href: `/cotizaciones-venta${qs}` }, { label: titulo }]}
          meta={
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Badge tone={badgeEstado(head.status)}>
                {ESTADO_COTIZACION[head.status] ?? head.status}
              </Badge>
              {head.valid_until && <span>Valida hasta {fecha(head.valid_until)}</span>}
              {head.terms && <span>· {head.terms}</span>}
              {head.sales_order_id && head.pedido && (
                <a
                  href={`/pedidos/${head.sales_order_id}${qs}`}
                  className="text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  Convertida en el pedido {head.pedido}
                </a>
              )}
            </div>
          }
          actions={
            lineas.length > 0 ? (
              <a
                href={`/cotizaciones-venta/${head.id}/imprimir${qs}`}
                className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="print" size={16} />
                Imprimir
              </a>
            ) : undefined
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Cliente" value={head.customer_name ?? '—'} />
          <StatCard label="Subtotal" value={`RD$ ${money(Number(head.subtotal))}`} />
          <StatCard label="ITBIS" value={`RD$ ${money(Number(head.tax))}`} />
          <StatCard label="Total" value={`RD$ ${money(Number(head.total))}`} />
        </section>

        {head.rejected_reason && (
          <p className="text-xs text-[var(--color-semantic-text-danger)]">
            <Icon name="info" size={12} /> Rechazada: {head.rejected_reason}
          </p>
        )}
        {head.supersedes_id && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Sustituye a{' '}
            <a
              href={`/cotizaciones-venta/${head.supersedes_id}${qs}`}
              className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              la version anterior
            </a>
          </p>
        )}

        {puedeGestionar && (
          <div className="flex flex-wrap gap-2">
            {enBorrador && lineas.length > 0 && (
              <form action={transicionarCotizacionForm}>
                {campos}
                <input type="hidden" name="siguiente" value="sent" />
                <BotonEnvio
                  title="La marca como enviada al cliente: desde ahi no se edita. Imprimela o mandasela."
                  className={botonClase}
                >
                  <Icon name="send" size={14} />
                  Marcar enviada
                </BotonEnvio>
              </form>
            )}
            {puedeConvertir && (
              <form action={convertirEnPedidoForm} className="flex flex-wrap items-center gap-2">
                {campos}
                {almacenes.length > 1 ? (
                  <select
                    name="warehouseId"
                    aria-label="Almacen que despacha"
                    className={claseInput}
                  >
                    {almacenes.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="hidden" name="warehouseId" value={almacenes[0]!.id} />
                )}
                <BotonEnvio
                  title="Crea el pedido en borrador con estas lineas y estos precios"
                  className={botonClase}
                >
                  <Icon name="shopping_cart" size={14} />
                  Convertir en pedido
                </BotonEnvio>
              </form>
            )}
            {head.status === 'sent' && (
              <>
                <form action={transicionarCotizacionForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="approved" />
                  <BotonEnvio title="El cliente la acepto" className={botonClase}>
                    <Icon name="check_circle" size={14} />
                    Aprobada por el cliente
                  </BotonEnvio>
                </form>
                <form action={transicionarCotizacionForm} className="flex items-end gap-2">
                  {campos}
                  <input type="hidden" name="siguiente" value="rejected" />
                  <input name="rejectedReason" placeholder="Motivo" className={claseInput} />
                  <BotonEnvio className={botonSecundarioClase}>Rechazar</BotonEnvio>
                </form>
                <form action={transicionarCotizacionForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="expired" />
                  <BotonEnvio className={botonSecundarioClase}>Marcar vencida</BotonEnvio>
                </form>
              </>
            )}
            {puedeRevisar && (
              <form action={crearVersionNuevaForm}>
                {campos}
                <BotonEnvio className={botonSecundarioClase}>
                  <Icon name="difference" size={14} />
                  Crear version nueva
                </BotonEnvio>
              </form>
            )}
          </div>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Producto</TH>
              <TH numeric>Cantidad</TH>
              <TH numeric>Precio</TH>
              <TH numeric>Total</TH>
              {enBorrador && puedeGestionar && (
                <TH>
                  <span className="sr-only">Acción</span>
                </TH>
              )}
            </TR>
          </THead>
          <TBody>
            {lineas.length === 0 ? (
              <TR>
                <TD
                  colSpan={enBorrador ? 5 : 4}
                  className="text-center text-[var(--color-text-muted)]"
                >
                  Todavía no hay ninguna línea.
                </TD>
              </TR>
            ) : (
              lineas.map((l) => (
                <TR key={l.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <Mono>{l.sku}</Mono> {l.name}
                  </TD>
                  <TD numeric>
                    <span className="tabular">{cant(l.quantity)}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(l.unit_price))}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(l.line_total))}</span>
                  </TD>
                  {enBorrador && puedeGestionar && (
                    <TD>
                      <form action={quitarLineaForm}>
                        {campos}
                        <input type="hidden" name="lineId" value={l.id} />
                        <BotonEnvio
                          aria-label={`Quitar ${l.name}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]"
                        >
                          <Icon name="delete" size={16} />
                        </BotonEnvio>
                      </form>
                    </TD>
                  )}
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {enBorrador && puedeGestionar && productos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Agregar línea</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={agregarLineaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto
                  <select name="productId" required className={claseInput}>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                        {p.price !== null ? ` (RD$ ${money(Number(p.price))})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input
                    name="quantity"
                    required
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Precio sin ITBIS (opcional)
                  <input
                    name="unitPrice"
                    inputMode="decimal"
                    placeholder="El de su lista"
                    title="Vacio = el precio que el cliente pagaria en un pedido: su lista de precios por cantidad, o el del catalogo."
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desc. % (opcional)
                  <input
                    name="discountPct"
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <BotonEnvio className={botonClase}>
                  <Icon name="add" size={14} />
                  Agregar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Sin precio escrito se usa el de la lista de precios del cliente para esa cantidad, o
                el del catalogo (entre parentesis). Escribe uno solo si negociaste otro.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
