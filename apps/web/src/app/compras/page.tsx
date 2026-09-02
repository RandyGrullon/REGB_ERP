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
import { crearOrdenForm } from './actions'
import { ESTADOS } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ordenes de compra · REGB ERP' }

interface OrderRow {
  id: string
  number: string
  supplier_name: string
  warehouse_name: string
  status: string
  order_date: string
  total: string
  lineas: string
  pendiente: boolean
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ordenes de compra (modulo 45): pedirle al proveedor y recibir lo que llega. */
export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; estado?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'purchase-orders')
  const q = (params.q ?? '').trim()
  const estado = params.estado ?? ''
  const hayFiltros = q !== '' || estado !== ''

  const [orders, suppliers, warehouses, totales] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const o = await tx<OrderRow[]>`
        select po.id, po.number, s.name as supplier_name, w.name as warehouse_name,
               po.status, po.order_date::text, po.total::text,
               (select count(*) from public.purchase_order_lines l
                 where l.order_id = po.id)::text as lineas,
               exists (select 1 from public.purchase_order_lines l
                        where l.order_id = po.id and l.qty_received < l.qty_ordered
                          and po.status in ('confirmed','partially_received')) as pendiente
        from public.purchase_orders po
        join public.suppliers s on s.id = po.supplier_id
        join public.warehouses w on w.id = po.warehouse_id
        where po.tenant_id = ${ctx.tenantId}
          and (${q} = '' or po.number ilike ${'%' + q + '%'} or s.name ilike ${'%' + q + '%'})
          and (${estado} = '' or po.status = ${estado})
        order by po.order_date desc, po.number desc
        limit 200`
      const s = await tx<{ id: string; name: string }[]>`
        select id, name from public.suppliers
        where tenant_id = ${ctx.tenantId} and is_active order by name`
      const w = await tx<{ id: string; name: string }[]>`
        select id, name from public.warehouses
        where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
      const [t] = await tx<{ abiertas: string; pendiente: string }[]>`
        select
          count(*) filter (where status in ('confirmed','partially_received')) as abiertas,
          coalesce(sum(total) filter (where status in ('confirmed','partially_received')), 0)::text
                                                                                as pendiente
        from public.purchase_orders where tenant_id = ${ctx.tenantId}`
      return [o, s, w, t] as const
    },
  )

  const puedeCrear = exigir(ctx, 'purchase-orders', 'purchase-orders.create').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <Shell {...shell} activePath="/compras">
      <div className="space-y-5">
        <PageHeader
          icon="local_shipping"
          title="Ordenes de compra"
          description="Confirmar es la promesa del proveedor; recibir es lo que de verdad entra al almacen, con su costo real."
          actions={
            <a
              href={`/compras/proveedores${qs}`}
              className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="local_shipping" size={18} />
              Proveedores
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Abiertas" value={String(totales?.abiertas ?? 0)} hint="por recibir" />
          <StatCard
            label="Comprometido"
            value={`RD$ ${money(Number(totales?.pendiente ?? 0))}`}
            hint="en ordenes abiertas"
          />
          <StatCard label="Proveedores" value={String(suppliers.length)} hint="activos" />
          <StatCard
            label="Total ordenes"
            value={String(orders.length > 200 ? '200+' : orders.length)}
            hint="mostradas"
          />
        </section>

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField
            defaultValue={q}
            label="Numero o proveedor"
            placeholder="OC-2026-00001, Distribuidora…"
          />
          <FilterSelect label="Estado" name="estado" defaultValue={estado}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </FilterSelect>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/compras${qs}`} />
        </Toolbar>

        {orders.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'local_shipping'}
            title={hayFiltros ? 'Ninguna orden coincide' : 'Todavia no hay ordenes de compra'}
            description={
              hayFiltros
                ? 'Prueba con otro numero, otro proveedor o quita el filtro de estado.'
                : 'Crea la primera abajo. Necesitas al menos un proveedor y un almacen.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Numero</TH>
                <TH>Proveedor</TH>
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
                        href={`/compras/${o.id}${qs}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Mono>{o.number}</Mono>
                      </a>
                    </TD>
                    <TD className="font-medium text-[var(--color-text-primary)]">
                      {o.supplier_name}
                    </TD>
                    <TD>{o.warehouse_name}</TD>
                    <TD>{fecha(o.order_date)}</TD>
                    <TD numeric>
                      <span className="tabular">{o.lineas}</span>
                    </TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge tone={e.tone}>{e.label}</Badge>
                        {o.pendiente && (
                          <Badge tone="info" dot={false} title="Todavia falta recibir mercancia">
                            pendiente
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

        {puedeCrear && suppliers.length > 0 && warehouses.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva orden de compra</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearOrdenForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Proveedor
                  <select
                    name="supplierId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Almacen que recibe
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
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="add" size={18} />
                  Crear borrador
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Se crea en borrador. Le agregas productos y despues la confirmas: eso todavia no
                mueve inventario, es una promesa del proveedor. Recibir es lo que de verdad entra.
              </p>
            </CardBody>
          </Card>
        )}

        {suppliers.length === 0 && (
          <Card>
            <CardBody className="pt-4 text-sm text-[var(--color-text-secondary)]">
              Necesitas al menos un proveedor para crear ordenes de compra.{' '}
              <a
                href={`/compras/proveedores${qs}`}
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
