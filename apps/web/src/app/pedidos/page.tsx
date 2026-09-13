import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  FilterSelect,
  Icon,
  Mono,
  PageHeader,
  SearchField,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Toolbar,
  ToolbarActions,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearPedidoForm } from './actions'
import { ESTADOS } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pedidos · REGB ERP' }

interface OrderRow {
  id: string
  number: string
  customer_name: string
  warehouse_name: string
  status: string
  order_date: string
  total: string
  lineas: string
  backorder: boolean
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Pedidos de venta (S20): vender formalmente, apartando lo que hay. */
export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; estado?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'sales-orders')
  const q = (params.q ?? '').trim()
  const estado = params.estado ?? ''
  const hayFiltros = q !== '' || estado !== ''

  const [orders, customers, warehouses, totales] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const o = await tx<OrderRow[]>`
        select so.id, so.number, c.name as customer_name, w.name as warehouse_name,
               so.status, so.order_date::text, so.total::text,
               (select count(*) from public.sales_order_lines l
                 where l.order_id = so.id)::text as lineas,
               exists (select 1 from public.sales_order_lines l
                        where l.order_id = so.id
                          and l.qty_reserved + l.qty_delivered < l.qty_ordered
                          and so.status in ('confirmed','partially_delivered')) as backorder
        from public.sales_orders so
        join public.customers c on c.id = so.customer_id
        join public.warehouses w on w.id = so.warehouse_id
        where so.tenant_id = ${ctx.tenantId}
          and (${q} = '' or so.number ilike ${'%' + q + '%'} or c.name ilike ${'%' + q + '%'})
          and (${estado} = '' or so.status = ${estado})
        order by so.order_date desc, so.number desc
        limit 200`
      const c = await tx<{ id: string; name: string }[]>`
        select id, name from public.customers
        where tenant_id = ${ctx.tenantId} and is_active order by name`
      const w = await tx<{ id: string; name: string }[]>`
        select id, name from public.warehouses
        where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
      const [t] = await tx<{ abiertos: string; pendiente: string; backorders: string }[]>`
        select
          count(*) filter (where status in ('confirmed','partially_delivered'))    as abiertos,
          coalesce(sum(total) filter (where status in ('confirmed','partially_delivered')), 0)::text
                                                                                   as pendiente,
          count(*) filter (where exists (
            select 1 from public.sales_order_lines l
            where l.order_id = sales_orders.id
              and l.qty_reserved + l.qty_delivered < l.qty_ordered)
            and status in ('confirmed','partially_delivered'))                     as backorders
        from public.sales_orders where tenant_id = ${ctx.tenantId}`
      return [o, c, w, t] as const
    },
  )

  const puedeCrear = exigir(ctx, 'sales-orders', 'sales-orders.create').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <Shell {...shell} activePath="/pedidos">
      <div className="space-y-5">
        <PageHeader
          icon="shopping_cart"
          title="Pedidos de venta"
          description="Confirmar aparta la mercancia sin sacarla del almacen; entregar es lo que la saca. Lo que no alcanza queda en backorder."
          actions={
            <a
              href={`/pedidos/clientes${qs}`}
              className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="contacts" size={18} />
              Clientes
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Abiertos" value={String(totales?.abiertos ?? 0)} hint="por entregar" />
          <StatCard
            label="Por facturar"
            value={`RD$ ${money(Number(totales?.pendiente ?? 0))}`}
            hint="en pedidos abiertos"
          />
          <StatCard
            label="Con backorder"
            value={String(totales?.backorders ?? 0)}
            hint="falta existencia"
          />
          <StatCard label="Clientes" value={String(customers.length)} hint="activos" />
        </section>

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField
            defaultValue={q}
            label="Numero o cliente"
            placeholder="PV-2026-00001, Ferreteria…"
          />
          <FilterSelect label="Estado" name="estado" defaultValue={estado}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </FilterSelect>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/pedidos${qs}`} />
        </Toolbar>

        {orders.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'shopping_cart'}
            title={hayFiltros ? 'Ningun pedido coincide' : 'Todavia no hay pedidos'}
            description={
              hayFiltros
                ? 'Prueba con otro numero, otro cliente o quita el filtro de estado.'
                : 'Crea el primero abajo. Necesitas al menos un cliente y un almacen.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Numero</TH>
                <TH>Cliente</TH>
                <TH>Almacen</TH>
                <TH>Fecha</TH>
                <TH numeric>Lineas</TH>
                <TH>Estado</TH>
                <TH numeric>Total</TH>
              </TR>
            </THead>
            <TBody>
              {orders.map((o) => {
                const e = ESTADOS[o.status] ?? { label: o.status, tone: 'neutral' as const }
                return (
                  <TR key={o.id}>
                    <TD>
                      <a
                        href={`/pedidos/${o.id}${qs}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Mono>{o.number}</Mono>
                      </a>
                    </TD>
                    <TD className="font-medium text-[var(--color-text-primary)]">
                      {o.customer_name}
                    </TD>
                    <TD>{o.warehouse_name}</TD>
                    <TD>{fecha(o.order_date)}</TD>
                    <TD numeric>
                      <span className="tabular">{o.lineas}</span>
                    </TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge tone={e.tone}>{e.label}</Badge>
                        {o.backorder && (
                          <Badge tone="warning" dot={false} title="Falta existencia por apartar">
                            backorder
                          </Badge>
                        )}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(o.total))}</span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeCrear && customers.length > 0 && warehouses.length > 0 && (
          <Card data-tour="pedido-nuevo">
            <CardHeader>
              <CardTitle>Nuevo pedido</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearPedidoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente
                  <select
                    name="customerId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Almacen que despacha
                  <select
                    name="warehouseId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Crear borrador
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Se crea en borrador. Le agregas lineas y despues lo confirmas: ahi es cuando se
                aparta la mercancia.
              </p>
            </CardBody>
          </Card>
        )}

        {customers.length === 0 && (
          <Card>
            <CardBody className="pt-4 text-sm text-[var(--color-text-secondary)]">
              Necesitas al menos un cliente para crear pedidos.{' '}
              <a
                href={`/pedidos/clientes${qs}`}
                className="text-[var(--color-text-link)] hover:underline"
              >
                Registra el primero
              </a>
              .
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
