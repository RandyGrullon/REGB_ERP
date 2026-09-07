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
import { crearBomForm } from './actions'
import { ESTADO_BOM } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Lista de materiales · REGB ERP' }

interface BomRow {
  id: string
  sku: string
  product_name: string
  version: number
  status: string
  output_qty: string
  lineas: string
}

interface ProductoOption {
  id: string
  sku: string
  name: string
}

const badgeEstado = (estado: string): 'success' | 'warning' | 'neutral' => {
  if (estado === 'active') return 'success'
  if (estado === 'draft') return 'warning'
  return 'neutral'
}

/** Lista de materiales (modulo 55): multinivel, versiones, sustitutos y costeo. */
export default async function BomPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'bom')

  const { boms, productos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const b = await tx<BomRow[]>`
      select bm.id, p.sku, p.name as product_name, bm.version, bm.status, bm.output_qty::text,
             (select count(*) from public.bom_lines l where l.bom_id = bm.id)::text as lineas
      from public.bill_of_materials bm
      join public.products p on p.id = bm.product_id
      where bm.tenant_id = ${ctx.tenantId}
      order by p.name, bm.version desc`
    const p = await tx<ProductoOption[]>`
      select id, sku, name from public.products
      where tenant_id = ${ctx.tenantId} and active order by name limit 300`
    return { boms: b, productos: p }
  })

  const activos = boms.filter((b) => b.status === 'active').length
  const puedeGestionar = exigir(ctx, 'bom', 'bom.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/bom">
      <div className="space-y-5">
        <PageHeader
          icon="account_tree"
          title="Lista de materiales"
          description="Costeo multinivel real -un componente puede tener su propia receta-, versiones y sustitutos."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="BOM activos" value={String(activos)} />
          <StatCard label="Total" value={String(boms.length)} />
        </section>

        {boms.length === 0 ? (
          <EmptyState icon="account_tree" title="Todavia no hay ningun BOM" description="Crea el primero abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto</TH>
                <TH numeric>Version</TH>
                <TH numeric>Produce</TH>
                <TH numeric>Componentes</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {boms.map((b) => (
                <TR key={b.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/bom/${b.id}${qs}`} className="underline-offset-2 hover:underline">
                      <Mono>{b.sku}</Mono> {b.product_name}
                    </a>
                  </TD>
                  <TD numeric>
                    <span className="tabular">v{b.version}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{b.output_qty}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{b.lineas}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(b.status)}>{ESTADO_BOM[b.status] ?? b.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo BOM</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearBomForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto terminado
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
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad producida
                  <input
                    name="outputQty"
                    defaultValue="1"
                    inputMode="decimal"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="add" size={14} />
                  Crear
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
