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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { cancelarDevolucionForm, enviarDevolucionForm } from './actions'
import { ESTADO_RECEPCION } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Recepciones · REGB ERP' }

interface OrdenPendiente {
  id: string
  number: string
  supplier_name: string
  warehouse_name: string
  pendiente: string
}

interface RecepcionRow {
  id: string
  order_number: string
  supplier_name: string
  received_at: string
  received_by_name: string | null
  status: string
}

interface DevolucionRow {
  id: string
  product_name: string
  supplier_name: string
  qty: string
  reason: string
  status: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Recepciones (modulo 46): inspeccion, discrepancias y devolucion al proveedor. */
export default async function RecepcionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'receipts')

  const { pendientes, recepciones, devoluciones } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const p = await tx<OrdenPendiente[]>`
        select po.id, po.number, s.name as supplier_name, w.name as warehouse_name,
               (select coalesce(sum(l.qty_ordered - l.qty_received), 0) from public.purchase_order_lines l
                 where l.order_id = po.id)::text as pendiente
        from public.purchase_orders po
        join public.suppliers s on s.id = po.supplier_id
        join public.warehouses w on w.id = po.warehouse_id
        where po.tenant_id = ${ctx.tenantId} and po.status in ('confirmed', 'partially_received')
        order by po.order_date desc`

      const r = await tx<RecepcionRow[]>`
        select gr.id, po.number as order_number, s.name as supplier_name,
               gr.received_at::text, up.display_name as received_by_name, gr.status
        from public.goods_receipts gr
        join public.purchase_orders po on po.id = gr.purchase_order_id
        join public.suppliers s on s.id = gr.supplier_id
        left join public.user_profiles up on up.tenant_id = gr.tenant_id and up.user_id = gr.received_by
        where gr.tenant_id = ${ctx.tenantId}
        order by gr.received_at desc
        limit 50`

      const d = await tx<DevolucionRow[]>`
        select sr.id, p.name as product_name, s.name as supplier_name,
               sr.qty::text, sr.reason, sr.status
        from public.supplier_returns sr
        join public.goods_receipt_lines grl on grl.id = sr.goods_receipt_line_id
        join public.products p on p.id = grl.product_id
        join public.suppliers s on s.id = sr.supplier_id
        where sr.tenant_id = ${ctx.tenantId} and sr.status = 'pending'
        order by sr.created_at desc`

      return { pendientes: p, recepciones: r, devoluciones: d }
    },
  )

  const conDiscrepancias = recepciones.filter((r) => r.status === 'with_discrepancies').length
  const puedeRecibir = exigir(ctx, 'receipts', 'receipts.receive').ok
  const puedeDevolver = exigir(ctx, 'receipts', 'receipts.return').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/recepciones">
      <div className="space-y-5">
        <PageHeader
          icon="inventory_2"
          title="Recepciones"
          description="Inspeccion real al recibir -aceptado contra rechazado-, discrepancia detectada sola, y devolucion al proveedor de lo que no paso."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Ordenes por recibir" value={String(pendientes.length)} />
          <StatCard label="Recepciones registradas" value={String(recepciones.length)} />
          <StatCard label="Con discrepancias" value={String(conDiscrepancias)} />
          <StatCard label="Devoluciones pendientes" value={String(devoluciones.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Ordenes por recibir</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {pendientes.length === 0 ? (
              <EmptyState
                icon="inventory_2"
                title="No hay ordenes con nada pendiente de recibir"
                description=""
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Orden</TH>
                    <TH>Proveedor</TH>
                    <TH>Almacen</TH>
                    <TH numeric>Pendiente</TH>
                    {puedeRecibir && (
                      <TH>
                        <span className="sr-only">Accion</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {pendientes.map((o) => (
                    <TR key={o.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        {puedeRecibir ? (
                          <a
                            href={`/recepciones/${o.id}${qs}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {o.number}
                          </a>
                        ) : (
                          o.number
                        )}
                      </TD>
                      <TD>{o.supplier_name}</TD>
                      <TD>{o.warehouse_name}</TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(o.pendiente))}</span>
                      </TD>
                      {puedeRecibir && (
                        <TD>
                          <a
                            href={`/recepciones/${o.id}${qs}`}
                            className="flex h-8 w-fit items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                          >
                            <Icon name="inventory_2" size={14} />
                            Recibir
                          </a>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Devoluciones pendientes</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {devoluciones.length === 0 ? (
              <EmptyState
                icon="assignment_return"
                title="No hay ninguna devolucion pendiente"
                description=""
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH>Proveedor</TH>
                    <TH numeric>Cantidad</TH>
                    <TH>Razon</TH>
                    {puedeDevolver && (
                      <TH>
                        <span className="sr-only">Accion</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {devoluciones.map((d) => (
                    <TR key={d.id}>
                      <TD className="text-[var(--color-text-primary)]">{d.product_name}</TD>
                      <TD>{d.supplier_name}</TD>
                      <TD numeric>
                        <span className="tabular">{d.qty}</span>
                      </TD>
                      <TD className="max-w-56 truncate">{d.reason}</TD>
                      {puedeDevolver && (
                        <TD>
                          <div className="flex gap-1.5">
                            <form action={enviarDevolucionForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="devolucionId" value={d.id} />
                              <button
                                type="submit"
                                className="flex h-8 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                              >
                                <Icon name="local_shipping" size={14} />
                                Enviar
                              </button>
                            </form>
                            <form action={cancelarDevolucionForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="devolucionId" value={d.id} />
                              <button
                                type="submit"
                                className="flex h-8 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                              >
                                <Icon name="close" size={14} />
                                Cancelar
                              </button>
                            </form>
                          </div>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recepciones registradas</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {recepciones.length === 0 ? (
              <EmptyState
                icon="fact_check"
                title="Todavia no se ha registrado ninguna recepcion"
                description=""
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Orden</TH>
                    <TH>Proveedor</TH>
                    <TH>Recibido por</TH>
                    <TH>Fecha</TH>
                    <TH>Estado</TH>
                  </TR>
                </THead>
                <TBody>
                  {recepciones.map((r) => (
                    <TR key={r.id}>
                      <TD className="text-[var(--color-text-primary)]">{r.order_number}</TD>
                      <TD>{r.supplier_name}</TD>
                      <TD>{r.received_by_name ?? '—'}</TD>
                      <TD>{new Date(r.received_at).toLocaleDateString('es-DO')}</TD>
                      <TD>
                        <Badge tone={r.status === 'with_discrepancies' ? 'warning' : 'success'}>
                          {ESTADO_RECEPCION[r.status] ?? r.status}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
