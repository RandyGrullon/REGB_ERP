import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
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

  const [transfers, warehouses] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
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
    return [t, w] as const
  })

  const puedeTransferir = exigir(ctx, 'inventory', 'inventory.transfer').ok
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
        <div>
          <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
            <a href={`/inventory${qs}`} className="text-[var(--color-text-link)] hover:underline">
              Existencias
            </a>{' '}
            › Transferencias
          </nav>
          <h1 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">
            Transferencias
          </h1>
        </div>

        {transfers.length === 0 ? (
          <EmptyState
            icon="swap_horiz"
            title="Sin transferencias todavia"
            description="Mueve stock entre almacenes con el formulario de abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH>De</TH>
                <TH>A</TH>
                <TH numeric>Cantidad</TH>
                <TH>Cuando</TH>
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
                    <span className="tabular">{t.qty}</span>
                  </TD>
                  <TD>{fecha(t.completed_at ?? t.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeTransferir && warehouses.length > 1 && (
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
                  Producto (id)
                  <input
                    name="productId"
                    required
                    placeholder="Copia el id desde el catalogo"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
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
                <button
                  type="submit"
                  className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Transferir
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
