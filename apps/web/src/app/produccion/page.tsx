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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearOrdenForm } from './actions'
import { ESTADO_ORDEN } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Ordenes de produccion · REGB ERP' }

interface OrdenRow {
  id: string
  sku: string
  product_name: string
  warehouse_name: string
  status: string
  qty_planned: string
  qty_completed: string
  qty_scrapped: string
}

interface BomOption {
  id: string
  sku: string
  name: string
}

interface AlmacenOption {
  id: string
  name: string
}

const badgeEstado = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'completed') return 'success'
  if (estado === 'in_progress' || estado === 'released') return 'warning'
  if (estado === 'cancelled') return 'danger'
  return 'neutral'
}

/** Ordenes de produccion (modulo 56): lanzamiento, consumo, avance y mermas. */
export default async function ProduccionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'manufacturing')

  const { ordenes, boms, almacenes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const o = await tx<OrdenRow[]>`
      select po.id, p.sku, p.name as product_name, w.name as warehouse_name, po.status,
             po.qty_planned::text, po.qty_completed::text, po.qty_scrapped::text
      from public.production_orders po
      join public.bill_of_materials bm on bm.id = po.bom_id
      join public.products p on p.id = bm.product_id
      join public.warehouses w on w.id = po.warehouse_id
      where po.tenant_id = ${ctx.tenantId}
      order by po.created_at desc
      limit 30`
    const b = await tx<BomOption[]>`
      select bm.id, p.sku, p.name from public.bill_of_materials bm
      join public.products p on p.id = bm.product_id
      where bm.tenant_id = ${ctx.tenantId} and bm.status = 'active'
      order by p.name`
    const w = await tx<AlmacenOption[]>`
      select id, name from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
    return { ordenes: o, boms: b, almacenes: w }
  })

  const enProgreso = ordenes.filter((o) => o.status === 'in_progress' || o.status === 'released').length
  const puedeGestionar = exigir(ctx, 'manufacturing', 'manufacturing.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/produccion">
      <div className="space-y-5">
        <PageHeader
          icon="precision_manufacturing"
          title="Ordenes de produccion"
          description="Lanzamiento sobre el BOM activo, consumo de una sola vez al liberar, avance y mermas con su propio historial."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="En progreso" value={String(enProgreso)} />
          <StatCard label="Total" value={String(ordenes.length)} />
        </section>

        {ordenes.length === 0 ? (
          <EmptyState icon="precision_manufacturing" title="Todavia no hay ninguna orden" description="Crea la primera abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH>Almacen</TH>
                <TH numeric>Planificado</TH>
                <TH numeric>Completado</TH>
                <TH numeric>Merma</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {ordenes.map((o) => (
                <TR key={o.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/produccion/${o.id}${qs}`} className="underline-offset-2 hover:underline">
                      <Mono>{o.sku}</Mono> {o.product_name}
                    </a>
                  </TD>
                  <TD>{o.warehouse_name}</TD>
                  <TD numeric>
                    <span className="tabular">{o.qty_planned}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular text-[var(--color-semantic-text-success)]">{o.qty_completed}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular text-[var(--color-semantic-text-danger)]">{o.qty_scrapped}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(o.status)}>{ESTADO_ORDEN[o.status] ?? o.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && boms.length > 0 && almacenes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva orden</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearOrdenForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  BOM activo
                  <select
                    name="bomId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {boms.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.sku} — {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Almacen
                  <select
                    name="warehouseId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {almacenes.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input
                    name="qtyPlanned"
                    required
                    inputMode="decimal"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
