import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, Mono, PageHeader, StatCard } from '@regb/ui'
import type { EstadoPedidoCanal } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { transicionarPedidoForm } from '../actions'
import { ESTADO_PEDIDO_CANAL, PLATAFORMA_CANAL } from '../estados'

export const dynamic = 'force-dynamic'

interface PedidoHead {
  id: string
  external_order_id: string
  channel_name: string
  platform: string
  customer_name: string
  customer_email: string | null
  total: string
  status: EstadoPedidoCanal
  received_at: string
}

interface Linea {
  id: string
  product_name: string | null
  external_sku: string
  quantity: string
  unit_price: string
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' => {
  if (s === 'imported') return 'success'
  if (s === 'cancelled') return 'danger'
  return 'warning'
}

/** Detalle de un pedido de canal (modulo 36): sus lineas tal cual llegaron, sin recalcular nada. */
export default async function PedidoCanalDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'ecommerce')

  const { head, lineas } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<PedidoHead[]>`
      select co.id, co.external_order_id, sc.name as channel_name, sc.platform,
             co.customer_name, co.customer_email, co.total::text, co.status, co.received_at::text
      from public.channel_orders co
      join public.sales_channels sc on sc.id = co.channel_id
      where co.id = ${id} and co.tenant_id = ${ctx.tenantId}`
    const l = await tx<Linea[]>`
      select col.id, p.name as product_name, col.external_sku, col.quantity::text, col.unit_price::text
      from public.channel_order_lines col
      left join public.products p on p.id = col.product_id
      where col.tenant_id = ${ctx.tenantId} and col.order_id = ${id}`
    return { head: h ?? null, lineas: l }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'ecommerce', 'ecommerce.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="orderId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/ecommerce">
      <div className="space-y-5">
        <PageHeader
          icon="storefront"
          title={head.external_order_id}
          crumbs={[{ label: 'E-commerce sync', href: `/ecommerce${qs}` }, { label: head.external_order_id }]}
          actions={<Badge tone={badgeEstado(head.status)}>{ESTADO_PEDIDO_CANAL[head.status] ?? head.status}</Badge>}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Canal" value={`${head.channel_name} (${PLATAFORMA_CANAL[head.platform] ?? head.platform})`} />
          <StatCard label="Cliente" value={head.customer_name} />
          <StatCard label="Total" value={`RD$ ${money(Number(head.total))}`} />
          <StatCard label="Recibido" value={new Date(head.received_at).toLocaleString('es-DO')} />
        </section>

        {puedeGestionar && head.status === 'received' && (
          <div className="flex flex-wrap gap-2">
            <form action={transicionarPedidoForm}>
              {campos}
              <input type="hidden" name="siguiente" value="imported" />
              <button type="submit" className={botonSecundarioClase}>
                <Icon name="check_circle" size={14} />
                Importar
              </button>
            </form>
            <form action={transicionarPedidoForm}>
              {campos}
              <input type="hidden" name="siguiente" value="cancelled" />
              <button type="submit" className={botonSecundarioClase}>
                Cancelar
              </button>
            </form>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Lineas</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-[var(--color-border)]">
              {lineas.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm text-[var(--color-text-primary)]">{l.product_name ?? 'Sin vincular'}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      SKU externo <Mono>{l.external_sku}</Mono> · {l.quantity} x RD$ {money(Number(l.unit_price))}
                    </p>
                  </div>
                  <span className="tabular text-sm text-[var(--color-text-primary)]">
                    RD$ {money(Number(l.quantity) * Number(l.unit_price))}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lo que esto no hace</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              El total de este pedido se registro tal cual llego -nunca se recalcula con una formula
              propia, porque ya lo calculo el canal externo-.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
