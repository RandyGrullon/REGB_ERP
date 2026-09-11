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
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { detectarDiscrepancia } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  agregarLineaForm,
  cancelarTransferenciaForm,
  despacharTransferenciaForm,
  quitarLineaForm,
  recibirTransferenciaForm,
} from '../actions'
import { ESTADO_TRANSFERENCIA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface OrdenHead {
  id: string
  status: string
  from_name: string
  to_name: string
  notes: string | null
}

interface LineaRow {
  id: string
  product_id: string
  sku: string
  name: string
  qty_requested: string
  qty_sent: string | null
  qty_received: string | null
}

interface ProductoOption {
  id: string
  sku: string
  name: string
}

const claseInput =
  'h-9 w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

/** Detalle de una transferencia (modulo 50): agregar lineas, despachar, recibir. */
export default async function TransferenciaDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'transfers')

  const { head, lineas, productos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OrdenHead[]>`
      select tord.id, tord.status, wf.name as from_name, wt.name as to_name, tord.notes
      from public.transfer_orders tord
      join public.warehouses wf on wf.id = tord.from_warehouse_id
      join public.warehouses wt on wt.id = tord.to_warehouse_id
      where tord.id = ${id} and tord.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, lineas: [], productos: [] }

    const l = await tx<LineaRow[]>`
      select l.id, l.product_id, p.sku, p.name,
             l.qty_requested::text, l.qty_sent::text, l.qty_received::text
      from public.transfer_order_lines l
      join public.products p on p.id = l.product_id
      where l.order_id = ${id} and l.tenant_id = ${ctx.tenantId}
      order by p.name`

    const prod =
      h.status === 'draft'
        ? await tx<ProductoOption[]>`
            select id, sku, name from public.products
            where tenant_id = ${ctx.tenantId} and active order by name limit 300`
        : []

    return { head: h, lineas: l, productos: prod }
  })

  if (!head) notFound()

  const puedeCrear = exigir(ctx, 'transfers', 'transfers.create').ok
  const puedeDespachar = exigir(ctx, 'transfers', 'transfers.dispatch').ok
  const puedeRecibir = exigir(ctx, 'transfers', 'transfers.receive').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="orderId" value={head.id} />
    </>
  )

  const enBorrador = head.status === 'draft'
  const enTransito = head.status === 'in_transit'

  return (
    <Shell {...shell} activePath="/transferencias">
      <div className="space-y-5">
        <PageHeader
          icon="local_shipping"
          title={`${head.from_name} → ${head.to_name}`}
          description={head.notes ?? ''}
          crumbs={[{ label: 'Transferencias', href: `/transferencias${qs}` }, { label: 'Detalle' }]}
          actions={
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  head.status === 'received'
                    ? 'success'
                    : head.status === 'in_transit'
                      ? 'warning'
                      : head.status === 'cancelled'
                        ? 'danger'
                        : 'neutral'
                }
              >
                {ESTADO_TRANSFERENCIA[head.status] ?? head.status}
              </Badge>
              {enBorrador && puedeDespachar && lineas.length > 0 && (
                <form action={despacharTransferenciaForm}>
                  {campos}
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="local_shipping" size={14} />
                    Despachar
                  </BotonEnvio>
                </form>
              )}
              {enBorrador && puedeCrear && (
                <form action={cancelarTransferenciaForm}>
                  {campos}
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                    <Icon name="cancel" size={14} />
                    Cancelar
                  </BotonEnvio>
                </form>
              )}
            </div>
          }
        />

        {enTransito && puedeRecibir ? (
          <Card>
            <CardHeader>
              <CardTitle>Recibir en {head.to_name}</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <form action={recibirTransferenciaForm}>
                {campos}
                <Table>
                  <THead>
                    <TR>
                      <TH>Producto</TH>
                      <TH numeric>Despachado</TH>
                      <TH numeric>Recibido</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {lineas.map((l) => (
                      <TR key={l.id}>
                        <TD className="text-[var(--color-text-primary)]">
                          <Mono>{l.sku}</Mono> {l.name}
                          <input type="hidden" name="lineId" value={l.id} />
                        </TD>
                        <TD numeric>
                          <span className="tabular">{l.qty_sent}</span>
                        </TD>
                        <TD numeric>
                          <input
                            name="qtyReceived"
                            defaultValue={l.qty_sent ?? ''}
                            inputMode="decimal"
                            aria-label={`Cantidad recibida de ${l.name}`}
                            className={claseInput}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <div className="border-t border-[var(--color-border)] p-3">
                  <BotonEnvio
                    
                    className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="inventory_2" size={18} />
                    Registrar recepcion
                  </BotonEnvio>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH numeric>Pedido</TH>
                <TH numeric>Despachado</TH>
                <TH numeric>Recibido</TH>
                {(head.status === 'received' || head.status === 'in_transit') && <TH>Discrepancia</TH>}
                {enBorrador && puedeCrear && (
                  <TH>
                    <span className="sr-only">Accion</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {lineas.map((l) => {
                const discrepancia =
                  l.qty_sent !== null && l.qty_received !== null
                    ? detectarDiscrepancia(Number(l.qty_sent), Number(l.qty_received))
                    : null
                return (
                  <TR key={l.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <Mono>{l.sku}</Mono> {l.name}
                    </TD>
                    <TD numeric>
                      <span className="tabular">{l.qty_requested}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{l.qty_sent ?? '—'}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{l.qty_received ?? '—'}</span>
                    </TD>
                    {(head.status === 'received' || head.status === 'in_transit') && (
                      <TD>
                        {discrepancia && discrepancia.tipo !== 'ninguna' ? (
                          <Badge tone={discrepancia.tipo === 'faltante' ? 'danger' : 'warning'}>
                            {discrepancia.tipo === 'faltante' ? 'Falto' : 'Sobro'}{' '}
                            {Math.abs(discrepancia.diferencia)}
                          </Badge>
                        ) : discrepancia ? (
                          <Badge tone="success">Coincide</Badge>
                        ) : (
                          '—'
                        )}
                      </TD>
                    )}
                    {enBorrador && puedeCrear && (
                      <TD>
                        <form action={quitarLineaForm}>
                          {campos}
                          <input type="hidden" name="lineId" value={l.id} />
                          <BotonEnvio
                            
                            aria-label={`Quitar ${l.name}`}
                            className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]">
                            <Icon name="delete" size={16} />
                          </BotonEnvio>
                        </form>
                      </TD>
                    )}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {enBorrador && puedeCrear && productos.length > 0 && (
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
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input name="qty" required inputMode="decimal" className={`tabular ${claseInput}`} />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Agregar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
