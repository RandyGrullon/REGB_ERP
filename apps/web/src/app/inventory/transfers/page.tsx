import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  Mono,
  PageHeader,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearTransferenciaForm } from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { cantidad } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Transferencias · REGB ERP' }

interface TransferRow {
  id: string
  from_name: string
  to_name: string
  sku: string
  product_name: string
  qty: string
  completed_at: string | null
  created_at: string
}

/**
 * Transferencias (S19): traslado simple de un paso, sin estado "en
 * transito" — la version completa llega con `transfers` (#50) en F8.
 */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'inventory')

  const [transfers, warehouses, productos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const t = await tx<TransferRow[]>`
      select st.id, wf.name as from_name, wt.name as to_name,
             p.sku, p.name as product_name, l.qty::text,
             st.completed_at::text, st.created_at::text
      from public.stock_transfers st
      join public.warehouses wf on wf.id = st.from_warehouse_id
      join public.warehouses wt on wt.id = st.to_warehouse_id
      join public.stock_transfer_lines l on l.transfer_id = st.id
      join public.products p on p.id = l.product_id
      where st.tenant_id = ${ctx.tenantId}
      order by st.created_at desc
      limit 50`
    const w = await tx<{ id: string; name: string }[]>`
      select id, name from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
    // Antes el formulario pedia el ID del producto "copiado del catalogo":
    // nadie en un almacen sabe que es un uuid, y uno mal pegado tumbaba la
    // pantalla. Se elige de la lista, solo lo que lleva existencias.
    const p = await tx<{ id: string; sku: string; name: string }[]>`
      select id, sku, name from public.products
      where tenant_id = ${ctx.tenantId} and active and tracks_stock
      order by name limit 300`
    return [t, w, p] as const
  })

  const puedeTransferir = exigir(ctx, 'inventory', 'inventory.transfer').ok
  // Con el módulo de Transferencias el traslado tiene despacho, tránsito y
  // recepción: es ahí donde el negocio mueve la mercancía.
  const hayModulo = exigir(ctx, 'transfers', 'transfers.view').ok
  const puedeAlmacenes = exigir(ctx, 'inventory', 'inventory.warehouses.manage').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/inventory/transfers">
      <div className="space-y-5">
        <PageHeader
          icon="swap_horiz"
          title="Transferencias"
          description="Mover mercancía de un almacén a otro en un solo paso: sale de uno y entra en el otro al mismo tiempo."
          crumbs={[{ label: 'Existencias', href: `/inventory${qs}` }, { label: 'Transferencias' }]}
        />

        {hayModulo && (
          <a
            href={`/transferencias${qs}`}
            className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-sm text-[var(--color-text-secondary)] hover:border-[var(--color-brand-bright)]"
          >
            <Icon name="info" size={20} className="mt-0.5 text-[var(--color-brand-bright)]" />
            <span>
              <span className="font-semibold text-[var(--color-text-primary)]">
                Tu negocio lleva las transferencias con despacho y recepción.
              </span>{' '}
              Las que salieron de un almacén y todavía no llegan al otro están en Transferencias,
              con su tránsito. Esta pantalla queda para un traslado rápido de un solo paso.
            </span>
          </a>
        )}

        {transfers.length === 0 ? (
          <EmptyState
            icon="swap_horiz"
            title="Sin traslados rápidos todavía"
            description={
              warehouses.length < 2
                ? 'Para transferir hace falta un segundo almacén: una sucursal, un depósito o el camión de reparto.'
                : hayModulo
                  ? 'Las transferencias de tu negocio se despachan y se reciben en Transferencias. Aquí solo aparecen los traslados rápidos de un paso.'
                  : 'Mueve mercancía entre almacenes con el formulario de abajo.'
            }
            action={
              warehouses.length < 2 && puedeAlmacenes ? (
                <a
                  href={`/inventory/warehouses${qs}`}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Crear otro almacén
                </a>
              ) : hayModulo ? (
                <a
                  href={`/transferencias${qs}`}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Ir a Transferencias
                </a>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH>De</TH>
                <TH>A</TH>
                <TH numeric>Cantidad</TH>
                <TH>Cuándo</TH>
              </TR>
            </THead>
            <TBody>
              {transfers.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <Mono>{t.sku}</Mono> {t.product_name}
                  </TD>
                  <TD>{t.from_name}</TD>
                  <TD>{t.to_name}</TD>
                  <TD numeric>
                    <span className="tabular">{cantidad(t.qty)}</span>
                  </TD>
                  <TD>{fecha(t.completed_at ?? t.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeTransferir && warehouses.length > 1 && productos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva transferencia</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearTransferenciaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-48 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  De
                  <select
                    name="fromWarehouseId"
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
                <label className="flex w-48 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  A
                  <select
                    name="toWarehouseId"
                    required
                    defaultValue={warehouses[1]?.id ?? warehouses[0]?.id}
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto
                  <select
                    name="productId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
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
                  <input
                    name="qty"
                    required
                    inputMode="decimal"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  Transferir
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
