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
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { diasPedidoCanalPendiente } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  crearCanalForm,
  simularPedidoEntranteForm,
  sincronizarVinculoForm,
  transicionarPedidoForm,
  vincularProductoForm,
} from './actions'
import { ESTADO_PEDIDO_CANAL, PLATAFORMA_CANAL } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'E-commerce sync · REGB ERP' }

interface CanalFila {
  id: string
  name: string
  platform: string
  status: string
}

interface VinculoFila {
  id: string
  channel_name: string
  product_name: string
  external_sku: string
  synced_at: string | null
}

interface PedidoFila {
  id: string
  external_order_id: string
  channel_name: string
  customer_name: string
  total: string
  status: string
  received_at: string
}

interface ProductoOption {
  id: string
  name: string
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const badgeCanal = (s: string): 'success' | 'neutral' => (s === 'connected' ? 'success' : 'neutral')
const badgePedido = (s: string): 'success' | 'danger' | 'warning' => {
  if (s === 'imported') return 'success'
  if (s === 'cancelled') return 'danger'
  return 'warning'
}

/** E-commerce sync (modulo 36): un pedido entrante se registra tal cual llega, nunca se recalcula su total. */
export default async function EcommercePage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ecommerce')

  const { canales, vinculos, pedidos, productos } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const c = await tx<CanalFila[]>`
      select id, name, platform, status from public.sales_channels
      where tenant_id = ${ctx.tenantId} order by created_at`
      const v = await tx<VinculoFila[]>`
      select cpl.id, sc.name as channel_name, p.name as product_name, cpl.external_sku, cpl.synced_at::text
      from public.channel_product_links cpl
      join public.sales_channels sc on sc.id = cpl.channel_id
      join public.products p on p.id = cpl.product_id
      where cpl.tenant_id = ${ctx.tenantId}
      order by sc.name, p.name`
      const p = await tx<PedidoFila[]>`
      select co.id, co.external_order_id, sc.name as channel_name, co.customer_name, co.total::text, co.status, co.received_at::text
      from public.channel_orders co
      join public.sales_channels sc on sc.id = co.channel_id
      where co.tenant_id = ${ctx.tenantId}
      order by co.received_at desc`
      const pr = await tx<ProductoOption[]>`
      select id, name from public.products where tenant_id = ${ctx.tenantId} and active order by name limit 300`
      return { canales: c, vinculos: v, pedidos: p, productos: pr }
    },
  )

  const porImportar = pedidos.filter((p) => p.status === 'received').length
  const puedeGestionar = exigir(ctx, 'ecommerce', 'ecommerce.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/ecommerce">
      <div className="space-y-5">
        <PageHeader
          icon="storefront"
          title="E-commerce sync"
          description="Un pedido entrante se registra tal cual llega -su total nunca se recalcula, ya lo calculo el canal externo-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Canales" value={String(canales.length)} />
          <StatCard label="Pedidos por importar" value={String(porImportar)} />
          <StatCard label="Vinculos de catalogo" value={String(vinculos.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Canales conectados</CardTitle>
          </CardHeader>
          <CardBody>
            {canales.length === 0 ? (
              <EmptyState
                icon="storefront"
                title="Todavia no hay ningun canal"
                description="Conecta el primero abajo."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Canal</TH>
                    <TH>Plataforma</TH>
                    <TH>Estado</TH>
                  </TR>
                </THead>
                <TBody>
                  {canales.map((c) => (
                    <TR key={c.id}>
                      <TD className="text-[var(--color-text-primary)]">{c.name}</TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {PLATAFORMA_CANAL[c.platform] ?? c.platform}
                      </TD>
                      <TD>
                        <Badge tone={badgeCanal(c.status)}>
                          {c.status === 'connected' ? 'Conectado' : 'Desconectado'}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && (
              <form action={crearCanalForm} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Plataforma
                  <select
                    name="platform"
                    defaultValue="shopify"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="shopify">Shopify</option>
                    <option value="woocommerce">WooCommerce</option>
                    <option value="tiendanube">Tiendanube</option>
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  URL de la tienda (opcional)
                  <input
                    name="storeUrl"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Conectar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pedidos entrantes</CardTitle>
          </CardHeader>
          <CardBody>
            {pedidos.length === 0 ? (
              <EmptyState
                icon="shopping_bag"
                title="Todavia no ha llegado ningun pedido"
                description="Simula el primero abajo."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Pedido</TH>
                    <TH>Canal</TH>
                    <TH>Cliente</TH>
                    <TH numeric>Total</TH>
                    <TH>Dias</TH>
                    <TH>Estado</TH>
                    <TH>
                      <span className="sr-only">Acción</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {pedidos.map((p) => {
                    const dias = diasPedidoCanalPendiente(new Date(p.received_at), new Date())
                    return (
                      <TR key={p.id}>
                        <TD className="text-[var(--color-text-primary)]">
                          <a
                            href={`/ecommerce/${p.id}${qs}`}
                            className="underline-offset-2 hover:underline"
                          >
                            <Mono>{p.external_order_id}</Mono>
                          </a>
                        </TD>
                        <TD className="text-[var(--color-text-muted)]">{p.channel_name}</TD>
                        <TD className="text-[var(--color-text-muted)]">{p.customer_name}</TD>
                        <TD numeric>
                          <span className="tabular">RD$ {money(Number(p.total))}</span>
                        </TD>
                        <TD className="text-[var(--color-text-muted)]">
                          {p.status === 'received' ? dias : '—'}
                        </TD>
                        <TD>
                          <Badge tone={badgePedido(p.status)}>
                            {ESTADO_PEDIDO_CANAL[p.status] ?? p.status}
                          </Badge>
                        </TD>
                        <TD>
                          {puedeGestionar && p.status === 'received' && (
                            <div className="flex gap-2">
                              <form action={transicionarPedidoForm}>
                                <input
                                  type="hidden"
                                  name="tenant"
                                  value={qs ? ctx.tenantSlug : ''}
                                />
                                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                                <input type="hidden" name="orderId" value={p.id} />
                                <input type="hidden" name="siguiente" value="imported" />
                                <BotonEnvio className="flex h-7 items-center rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                                  Importar
                                </BotonEnvio>
                              </form>
                            </div>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}

            {puedeGestionar && (
              <form
                action={simularPedidoEntranteForm}
                className="mt-4 flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Canal
                  <select
                    name="channelId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {canales.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  N.º de pedido
                  <input
                    name="externalOrderId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente
                  <input
                    name="customerName"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Correo (opcional)
                  <input
                    name="customerEmail"
                    type="email"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto (opcional)
                  <select
                    name="productId"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Sin vincular</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  SKU externo
                  <input
                    name="externalSku"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input
                    name="quantity"
                    required
                    inputMode="decimal"
                    defaultValue="1"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Precio unitario
                  <input
                    name="unitPrice"
                    required
                    inputMode="decimal"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Simular pedido
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vinculos de catálogo</CardTitle>
          </CardHeader>
          <CardBody>
            {vinculos.length === 0 ? (
              <EmptyState
                icon="inventory_2"
                title="Todavia no hay ningun producto vinculado"
                description="Vincula el primero abajo."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Canal</TH>
                    <TH>Producto</TH>
                    <TH>SKU externo</TH>
                    <TH>Sincronizado</TH>
                    <TH>
                      <span className="sr-only">Acción</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {vinculos.map((v) => (
                    <TR key={v.id}>
                      <TD className="text-[var(--color-text-muted)]">{v.channel_name}</TD>
                      <TD className="text-[var(--color-text-primary)]">{v.product_name}</TD>
                      <TD className="text-[var(--color-text-muted)]">
                        <Mono>{v.external_sku}</Mono>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {v.synced_at ? new Date(v.synced_at).toLocaleString('es-DO') : 'Nunca'}
                      </TD>
                      <TD>
                        {puedeGestionar && (
                          <form action={sincronizarVinculoForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="linkId" value={v.id} />
                            <BotonEnvio className="flex h-7 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                              <Icon name="sync" size={12} />
                              Sincronizar
                            </BotonEnvio>
                          </form>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && (
              <form action={vincularProductoForm} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Canal
                  <select
                    name="channelId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {canales.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto
                  <select
                    name="productId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  SKU externo
                  <input
                    name="externalSku"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Vincular
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
