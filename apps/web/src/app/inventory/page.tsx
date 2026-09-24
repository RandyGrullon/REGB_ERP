import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Mono,
  StatCard,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@regb/ui'
import { isLowStock } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ajustarInventarioForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Existencias · REGB ERP' }

interface StockRow {
  product_id: string
  sku: string
  name: string
  unit: string
  warehouse_id: string
  warehouse_name: string
  qty_on_hand: string
  qty_reserved: string
  avg_cost: string
  reorder_point: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Existencias (S19): lo que hay ahora mismo, por almacen, con su costo
 * promedio. Replica el mockup del marketplace (§0013): SKUs, valor total,
 * bajos, y filtro por almacen.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { almacen?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'inventory')
  const almacenFiltro = params.almacen ?? ''

  const [rows, warehouses, productosAjuste] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const r = await tx<StockRow[]>`
      select sl.product_id, p.sku, p.name, p.unit,
             sl.warehouse_id, w.name as warehouse_name,
             sl.qty_on_hand::text, sl.qty_reserved::text, sl.avg_cost::text,
             p.reorder_point::text
      -- existencias() y no stock_levels: la funcion tapa el costo para
      -- quien no tiene inventory.cost.view (0109). Antes lo escondia solo
      -- la plantilla, y bastaba con pedirle la tabla a PostgREST.
      --
      -- Sin acentos graves en este comentario: van dentro de una
      -- plantilla de JavaScript y cortan la cadena. Compila hasta que
      -- alguien escribe uno.
      from public.existencias() sl
      join public.products p on p.id = sl.product_id
      join public.warehouses w on w.id = sl.warehouse_id
      where sl.tenant_id = ${ctx.tenantId}
        and (${almacenFiltro} = '' or sl.warehouse_id = ${almacenFiltro || null}::uuid)
      order by p.name, w.name`
    const w = await tx<{ id: string; name: string }[]>`
      select id, name from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
    // Para el selector del ajuste: solo lo que lleva existencias (0100).
    // El valor de cada opcion es el SKU; la etiqueta, nombre y codigo de
    // barras, que es por donde busca quien escribe.
    const p = await tx<{ sku: string; name: string; barcode: string | null }[]>`
      select sku, name, barcode from public.products
      where tenant_id = ${ctx.tenantId} and active and tracks_stock
      order by name
      limit 5000`
    return [r, w, p] as const
  })

  const puedeAjustar = exigir(ctx, 'inventory', 'inventory.adjust').ok
  const veCosto = exigir(ctx, 'inventory', 'inventory.cost.view').ok
  // La carga masiva vive en /importar y pide ademas imports.create.
  const puedeImportarExistencias = puedeAjustar && exigir(ctx, 'imports', 'imports.create').ok

  const valorTotal = rows.reduce((a, r) => a + Number(r.qty_on_hand) * Number(r.avg_cost), 0)
  const bajos = rows.filter((r) =>
    isLowStock(Number(r.qty_on_hand), r.reorder_point ? Number(r.reorder_point) : null),
  )

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/inventory">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Existencias</h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Lo que hay ahora mismo, por almacén.
            </p>
          </div>
          <form method="get" className="flex items-end gap-2">
            {qs && (
              <>
                <input type="hidden" name="tenant" value={ctx.tenantSlug} />
                <input type="hidden" name="rol" value={ctx.roleName} />
              </>
            )}
            <select
              name="almacen"
              aria-label="Filtrar por almacen"
              defaultValue={almacenFiltro}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">Todos los almacenes</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <BotonEnvio className="h-10 rounded-full border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
              Filtrar
            </BotonEnvio>
          </form>
        </div>

        <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="SKUs" value={String(rows.length)} hint="lineas de existencia" />
          {veCosto && (
            <StatCard label="Valor" value={`RD$ ${money(valorTotal)}`} hint="al costo promedio" />
          )}
          <StatCard label="Bajos" value={String(bajos.length)} hint="bajo el punto de reorden" />
          <StatCard label="Almacenes" value={String(warehouses.length)} hint="activos" />
        </section>

        {rows.length === 0 ? (
          <EmptyState
            icon="inventory_2"
            title="Sin existencias todavia"
            description={
              puedeImportarExistencias
                ? 'Carga las existencias iniciales de todo el catálogo con un CSV (código, almacén, cantidad y costo), o producto por producto con el ajuste de abajo.'
                : 'Registra la existencia inicial con el ajuste de abajo, con su costo, o transfiere desde otro almacén.'
            }
            action={
              puedeImportarExistencias ? (
                <a
                  href={`/importar${qs}#existencias`}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  Cargar existencias desde CSV
                </a>
              ) : undefined
            }
          />
        ) : (
          <Table data-tour="existencias-tabla">
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Producto</TH>
                <TH>Almacén</TH>
                <TH numeric>Disponible</TH>
                <TH numeric>Reservado</TH>
                {veCosto && <TH numeric>Costo</TH>}
                {veCosto && <TH numeric>Valor</TH>}
                <TH>
                  <span className="sr-only">Estado</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const onHand = Number(r.qty_on_hand)
                const reservado = Number(r.qty_reserved)
                const bajo = isLowStock(onHand, r.reorder_point ? Number(r.reorder_point) : null)
                return (
                  <TR key={`${r.product_id}-${r.warehouse_id}`}>
                    <TD>
                      <Mono>{r.sku}</Mono>
                    </TD>
                    <TD className="font-medium text-[var(--color-text-primary)]">{r.name}</TD>
                    <TD>{r.warehouse_name}</TD>
                    <TD numeric>
                      <span className="tabular">
                        {onHand - reservado} {r.unit}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-text-muted)]">{reservado}</span>
                    </TD>
                    {veCosto && (
                      <TD numeric>
                        <span className="tabular">{money(Number(r.avg_cost))}</span>
                      </TD>
                    )}
                    {veCosto && (
                      <TD numeric>
                        <span className="tabular">{money(onHand * Number(r.avg_cost))}</span>
                      </TD>
                    )}
                    <TD>
                      <span className="flex flex-wrap gap-1">
                        {bajo && (
                          <Badge tone="warning" title={`Punto de reorden: ${r.reorder_point}`}>
                            bajo
                          </Badge>
                        )}
                        {onHand < 0 && (
                          <Badge tone="danger" title="Se vendio mas de lo que habia registrado">
                            negativo
                          </Badge>
                        )}
                        {/* Comprometido por encima de lo que hay: un pedido
                            confirmado ya no se puede despachar completo. */}
                        {reservado > onHand && (
                          <Badge
                            tone="danger"
                            title={`Hay ${reservado} apartadas para pedidos pero solo quedan ${onHand} en existencia. Algun pedido confirmado no se podrá despachar.`}
                          >
                            sobre-apartado
                          </Badge>
                        )}
                      </span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeAjustar && warehouses.length > 0 && (
          <Card data-tour="inventario-ajuste">
            <CardHeader>
              <CardTitle>Ajuste manual</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={ajustarInventarioForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Almacen
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
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto
                  {/* Lista nativa: funciona sin JavaScript y busca por lo que
                      se escribe -nombre, código o código de barras-. La acción
                      vuelve a resolverlo en el servidor. */}
                  <input
                    name="producto"
                    required
                    list="productos-ajuste"
                    autoComplete="off"
                    placeholder="Nombre, codigo o codigo de barras"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                  <datalist id="productos-ajuste">
                    {productosAjuste.map((p) => (
                      <option key={p.sku} value={p.sku}>
                        {p.barcode ? `${p.name} · ${p.barcode}` : p.name}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cantidad
                  <input
                    name="qty"
                    required
                    inputMode="decimal"
                    placeholder="-3 o 10"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Costo unitario
                  <input
                    name="unitCost"
                    inputMode="decimal"
                    placeholder="opcional"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Motivo
                  <input
                    name="reason"
                    required
                    minLength={3}
                    placeholder="Merma por rotura"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  Ajustar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Cantidad positiva = entra. Negativa = sale. Una entrada sin costo toma el del
                catalogo. Un ajuste grande puede pedir aprobacion segun tu rol; queda registrado en
                el kardex y no se puede editar después, solo corregir con otro ajuste.
                {puedeImportarExistencias && (
                  <>
                    {' '}
                    Para cargar muchas existencias a la vez,{' '}
                    <a
                      href={`/importar${qs}#existencias`}
                      className="text-[var(--color-text-link)] underline hover:no-underline"
                    >
                      subelas en un CSV
                    </a>
                    .
                  </>
                )}
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
