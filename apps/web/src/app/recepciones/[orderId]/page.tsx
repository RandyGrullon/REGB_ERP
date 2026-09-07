import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  Mono,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { pendingReceipt, qtyDisponibleParaDevolver, type PurchaseLineState } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { registrarDevolucionForm, registrarRecepcionForm } from '../actions'
import { ESTADO_DEVOLUCION } from '../estados'

export const dynamic = 'force-dynamic'

interface OrdenHead {
  id: string
  number: string
  status: string
  supplier_name: string
  warehouse_name: string
}

interface LineaPendiente {
  id: string
  sku: string
  name: string
  unit: string
  qty_ordered: string
  qty_received: string
  unit_cost: string
}

interface LineaRecepcionPrevia {
  id: string
  product_name: string
  qty_received: string
  qty_accepted: string
  qty_rejected: string
  rejection_reason: string | null
  ya_devuelto: string
  devoluciones: { id: string; qty: string; status: string; reason: string }[]
}

const claseInput =
  'h-9 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

/** Recibir una orden de compra (modulo 46): inspeccion linea por linea, un solo documento. */
export default async function RecibirOrdenPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>
  searchParams: Promise<DemoParams>
}) {
  const { orderId } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'receipts', 'receipts.receive')

  const { head, lineas, previas } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OrdenHead[]>`
      select po.id, po.number, po.status, s.name as supplier_name, w.name as warehouse_name
      from public.purchase_orders po
      join public.suppliers s on s.id = po.supplier_id
      join public.warehouses w on w.id = po.warehouse_id
      where po.id = ${orderId} and po.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, lineas: [], previas: [] }

    const l = await tx<LineaPendiente[]>`
      select l.id, p.sku, p.name, p.unit, l.qty_ordered::text, l.qty_received::text, l.unit_cost::text
      from public.purchase_order_lines l
      join public.products p on p.id = l.product_id
      where l.order_id = ${orderId} and l.tenant_id = ${ctx.tenantId}
        and l.qty_received < l.qty_ordered
      order by p.name`

    const prevRows = await tx<
      (LineaRecepcionPrevia & { return_id: string | null; return_qty: string | null; return_status: string | null; return_reason: string | null })[]
    >`
      select grl.id, p.name as product_name, grl.qty_received::text, grl.qty_accepted::text,
             grl.qty_rejected::text, grl.rejection_reason,
             coalesce((select sum(sr.qty) from public.supplier_returns sr
                        where sr.goods_receipt_line_id = grl.id and sr.status != 'cancelled'), 0)::text
               as ya_devuelto,
             sr2.id as return_id, sr2.qty::text as return_qty, sr2.status as return_status,
             sr2.reason as return_reason
      from public.goods_receipt_lines grl
      join public.products p on p.id = grl.product_id
      left join public.supplier_returns sr2 on sr2.goods_receipt_line_id = grl.id
      where grl.tenant_id = ${ctx.tenantId} and grl.purchase_order_line_id in
        (select id from public.purchase_order_lines where order_id = ${orderId} and tenant_id = ${ctx.tenantId})
      order by grl.created_at desc`

    const porLinea = new Map<string, LineaRecepcionPrevia>()
    for (const r of prevRows) {
      const existente = porLinea.get(r.id) ?? {
        id: r.id,
        product_name: r.product_name,
        qty_received: r.qty_received,
        qty_accepted: r.qty_accepted,
        qty_rejected: r.qty_rejected,
        rejection_reason: r.rejection_reason,
        ya_devuelto: r.ya_devuelto,
        devoluciones: [],
      }
      if (r.return_id) {
        existente.devoluciones.push({
          id: r.return_id,
          qty: r.return_qty!,
          status: r.return_status!,
          reason: r.return_reason!,
        })
      }
      porLinea.set(r.id, existente)
    }

    return { head: h, lineas: l, previas: [...porLinea.values()] }
  })

  if (!head) notFound()
  if (head.status !== 'confirmed' && head.status !== 'partially_received') notFound()

  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

  return (
    <Shell {...shell} activePath="/recepciones">
      <div className="space-y-5">
        <PageHeader
          icon="inventory_2"
          title={`Recibir ${head.number}`}
          description={`${head.supplier_name} · entra a ${head.warehouse_name}`}
          crumbs={[{ label: 'Recepciones', href: `/recepciones${qs}` }, { label: head.number }]}
        />

        {lineas.length === 0 ? (
          <Card>
            <CardBody className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              Esta orden ya no tiene nada pendiente de recibir.
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Inspeccion de lo que llego</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <form action={registrarRecepcionForm}>
                {campos}
                <input type="hidden" name="orderId" value={head.id} />
                <Table>
                  <THead>
                    <TR>
                      <TH>Producto</TH>
                      <TH numeric>Pendiente</TH>
                      <TH numeric>Recibido</TH>
                      <TH numeric>Aceptado</TH>
                      <TH numeric>Rechazado</TH>
                      <TH>Razon del rechazo</TH>
                      <TH numeric>Costo real</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {lineas.map((l) => {
                      const estado: PurchaseLineState = {
                        qtyOrdered: Number(l.qty_ordered),
                        qtyReceived: Number(l.qty_received),
                      }
                      const pendiente = pendingReceipt(estado)
                      return (
                        <TR key={l.id}>
                          <TD className="text-[var(--color-text-primary)]">
                            <Mono>{l.sku}</Mono> {l.name}
                            <input type="hidden" name="lineId" value={l.id} />
                          </TD>
                          <TD numeric>
                            <span className="tabular">
                              {pendiente} {l.unit}
                            </span>
                          </TD>
                          <TD numeric>
                            <input
                              name="qtyReceived"
                              defaultValue={String(pendiente)}
                              inputMode="decimal"
                              aria-label={`Cantidad recibida de ${l.name}`}
                              className={claseInput}
                            />
                          </TD>
                          <TD numeric>
                            <input
                              name="qtyAccepted"
                              defaultValue={String(pendiente)}
                              inputMode="decimal"
                              aria-label={`Cantidad aceptada de ${l.name}`}
                              className={claseInput}
                            />
                          </TD>
                          <TD numeric>
                            <input
                              name="qtyRejected"
                              defaultValue="0"
                              inputMode="decimal"
                              aria-label={`Cantidad rechazada de ${l.name}`}
                              className={claseInput}
                            />
                          </TD>
                          <TD>
                            <input
                              name="rejectionReason"
                              placeholder="Si rechazaste algo, por que"
                              aria-label={`Razon del rechazo de ${l.name}`}
                              className="h-9 w-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                            />
                          </TD>
                          <TD numeric>
                            <input
                              name="unitCost"
                              defaultValue={l.unit_cost}
                              inputMode="decimal"
                              aria-label={`Costo real de ${l.name}`}
                              className={claseInput}
                            />
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
                <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] p-3">
                  <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Notas de la recepcion
                    <input
                      name="notes"
                      placeholder="Numero de factura del proveedor, placa del camion, etc."
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                    />
                  </label>
                  <button
                    type="submit"
                    className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                  >
                    <Icon name="fact_check" size={18} />
                    Registrar recepcion
                  </button>
                </div>
              </form>
              <p className="px-3 pb-3 text-xs text-[var(--color-text-muted)]">
                Deja en cero lo que no llego en este camion -no hace falta recibir todas las
                lineas a la vez-. Solo lo aceptado entra al inventario disponible para vender; lo
                rechazado queda fuera del on_hand hasta que se resuelva la devolucion.
              </p>
            </CardBody>
          </Card>
        )}

        {previas.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Lo ya recibido de esta orden</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH numeric>Recibido</TH>
                    <TH numeric>Aceptado</TH>
                    <TH numeric>Rechazado</TH>
                    <TH>Devolucion</TH>
                  </TR>
                </THead>
                <TBody>
                  {previas.map((p) => {
                    const disponible = qtyDisponibleParaDevolver(
                      Number(p.qty_rejected),
                      Number(p.ya_devuelto),
                    )
                    return (
                      <TR key={p.id}>
                        <TD className="text-[var(--color-text-primary)]">{p.product_name}</TD>
                        <TD numeric>
                          <span className="tabular">{p.qty_received}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular text-[var(--color-semantic-text-success)]">
                            {p.qty_accepted}
                          </span>
                        </TD>
                        <TD numeric>
                          <span className="tabular text-[var(--color-semantic-text-danger)]">
                            {p.qty_rejected}
                          </span>
                        </TD>
                        <TD>
                          {p.devoluciones.length > 0 && (
                            <div className="mb-1 flex flex-wrap gap-1">
                              {p.devoluciones.map((d) => (
                                <Badge
                                  key={d.id}
                                  tone={d.status === 'sent' ? 'success' : d.status === 'cancelled' ? 'neutral' : 'warning'}
                                >
                                  {d.qty} · {ESTADO_DEVOLUCION[d.status] ?? d.status}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {disponible > 0 && (
                            <form action={registrarDevolucionForm} className="flex flex-wrap items-center gap-1">
                              {campos}
                              <input type="hidden" name="goodsReceiptLineId" value={p.id} />
                              <input
                                name="qty"
                                defaultValue={String(disponible)}
                                inputMode="decimal"
                                aria-label={`Cantidad a devolver de ${p.product_name}`}
                                className="h-8 w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                              />
                              <input
                                name="reason"
                                placeholder="Razon"
                                defaultValue={p.rejection_reason ?? ''}
                                aria-label={`Razon de la devolucion de ${p.product_name}`}
                                className="h-8 w-32 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                              />
                              <button
                                type="submit"
                                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                              >
                                Devolver
                              </button>
                            </form>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        )}

        {lineas.length === 0 && previas.length === 0 && (
          <EmptyState icon="fact_check" title="Sin movimiento todavia" description="" />
        )}
      </div>
    </Shell>
  )
}
