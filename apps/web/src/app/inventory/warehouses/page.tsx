import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import { crearAlmacenForm } from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { cantidad, pesos } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Almacenes · REGB ERP' }

interface WarehouseRow {
  id: string
  name: string
  code: string | null
  branch_name: string | null
  is_default: boolean
  is_active: boolean
  productos: string
  valor: string | null
}

/** Almacenes (S19): oculta en el sidebar, la usan quienes gestionan la operacion. */
export default async function WarehousesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'inventory')
  const veCosto = exigir(ctx, 'inventory', 'inventory.cost.view').ok
  // Ver la lista es de quien ve inventario; dar de alta, de quien gestiona
  // almacenes (antes el formulario salía a cualquiera y fallaba al enviar).
  const puedeGestionar = exigir(ctx, 'inventory', 'inventory.warehouses.manage').ok

  const [warehouses, branches] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const w = await tx<WarehouseRow[]>`
      select w.id, w.name, w.code, b.name as branch_name, w.is_default, w.is_active,
             (select count(*) from public.stock_levels sl
               where sl.warehouse_id = w.id and sl.qty_on_hand <> 0)::text as productos,
             (select sum(sl.qty_on_hand * sl.avg_cost) from public.existencias() sl
               where sl.warehouse_id = w.id)::text as valor
      from public.warehouses w
      left join public.branches b on b.id = w.branch_id
      where w.tenant_id = ${ctx.tenantId}
      order by w.is_default desc, w.name`
    const b = await tx<{ id: string; name: string }[]>`
      select id, name from public.branches
      where tenant_id = ${ctx.tenantId} and deleted_at is null order by name`
    return [w, b] as const
  })

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/inventory/warehouses">
      <div className="max-w-4xl space-y-5">
        <PageHeader
          icon="warehouse"
          title="Almacenes"
          description="Dónde se guarda la mercancía. Cada venta, recepción y conteo dice de qué almacén sale o a cuál entra."
          crumbs={[{ label: 'Existencias', href: `/inventory${qs}` }, { label: 'Almacenes' }]}
        />

        <Table>
          <THead>
            <TR>
              <TH>Nombre</TH>
              <TH>Código</TH>
              <TH>Sucursal</TH>
              <TH numeric>Productos</TH>
              {veCosto && <TH numeric>Valor</TH>}
              <TH>Estado</TH>
            </TR>
          </THead>
          <TBody>
            {warehouses.map((w) => (
              <TR key={w.id}>
                <TD className="font-medium text-[var(--color-text-primary)]">
                  <a
                    href={`/inventory${qs}${qs ? '&' : '?'}almacen=${w.id}`}
                    className="hover:underline"
                    title="Ver sus existencias"
                  >
                    {w.name}
                  </a>
                </TD>
                <TD>{w.code ? <Mono>{w.code}</Mono> : '—'}</TD>
                <TD>{w.branch_name ?? 'Sin sucursal'}</TD>
                <TD numeric>
                  <span className="tabular">{cantidad(w.productos)}</span>
                </TD>
                {veCosto && (
                  <TD numeric>
                    <span className="tabular">{w.valor ? pesos(w.valor) : '—'}</span>
                  </TD>
                )}
                <TD>
                  {w.is_default && <Badge tone="brand">Predeterminado</Badge>}
                  {!w.is_active && <Badge tone="neutral">Inactivo</Badge>}
                  {w.is_active && !w.is_default && <Badge tone="success">Activo</Badge>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo almacén</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearAlmacenForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    minLength={2}
                    placeholder="Depósito central"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Código
                  <input
                    name="code"
                    placeholder="DEP-1"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Sucursal
                  <select
                    name="branchId"
                    defaultValue=""
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    <option value="">Sin sucursal (depósito central)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio className="h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
