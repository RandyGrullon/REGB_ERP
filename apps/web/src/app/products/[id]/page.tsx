import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Mono,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { editarProductoForm } from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { cantidad, pesos } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'

interface ProductDetail {
  id: string
  sku: string
  name: string
  unit: string
  price: string
  cost: string | null
  barcode: string | null
  category_id: string | null
  tax_rate: string
  reorder_point: string | null
  track_stock: boolean
  active: boolean
  created_at: string
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] disabled:opacity-50'

/** Ficha del producto (S18): ver y editar, con el precio bajo su propio permiso. */
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const sp = await searchParams
  const { id } = await params
  const { ctx, shell } = await modulePage(sp, 'products')

  const veExistencia = ctx.licensedModules.has('inventory')

  const [product, categories, existencias] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [p] = await tx<ProductDetail[]>`
      select id, sku, name, unit, price::text, cost::text, barcode, category_id,
             tax_rate::text, reorder_point::text, track_stock, active, created_at::text
      from public.products
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    const c = await tx<{ id: string; name: string }[]>`
      select id, name from public.product_categories
      where tenant_id = ${ctx.tenantId} order by name`
    const e = veExistencia
      ? await tx<{ almacen: string; disponible: string; reservado: string }[]>`
          select w.name as almacen, sl.qty_on_hand::text as disponible,
                 sl.qty_reserved::text as reservado
          from public.stock_levels sl
          join public.warehouses w on w.id = sl.warehouse_id
          where sl.product_id = ${id} and sl.tenant_id = ${ctx.tenantId}
          order by w.is_default desc, w.name`
      : []
    return [p, c, e] as const
  })

  if (!product) notFound()

  const puedeEditar = exigir(ctx, 'products', 'products.edit').ok
  const vePrecio = exigir(ctx, 'products', 'products.price.view').ok
  const editaPrecio = exigir(ctx, 'products', 'products.price.edit').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/products">
      <div className="max-w-3xl space-y-5">
        <PageHeader
          icon={product.track_stock ? 'inventory_2' : 'home_repair_service'}
          title={product.name}
          description={
            product.track_stock
              ? `Se vende por ${product.unit}. Dado de alta el ${new Date(product.created_at).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })}.`
              : 'Servicio: se cobra y se factura, pero no lleva existencias.'
          }
          crumbs={[{ label: 'Catálogo', href: `/products${qs}` }, { label: product.sku }]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Mono>{product.sku}</Mono>
              {!product.active && <Badge tone="neutral">Archivado</Badge>}
              {Number(product.tax_rate) === 0 ? (
                <Badge tone="info">Exento de ITBIS</Badge>
              ) : (
                <Badge tone="neutral" dot={false}>
                  ITBIS {Math.round(Number(product.tax_rate) * 100)} %
                </Badge>
              )}
              {vePrecio && (
                <Badge tone="neutral" dot={false}>
                  Precio {pesos(product.price)}
                </Badge>
              )}
            </div>
          }
        />

        {veExistencia && product.track_stock && (
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Existencias</CardTitle>
              <a
                href={`/inventory/movements${qs}${qs ? '&' : '?'}producto=${product.id}`}
                className="text-xs text-[var(--color-text-link)] hover:underline"
              >
                Ver sus movimientos en el kardex
              </a>
            </CardHeader>
            {existencias.length === 0 ? (
              <CardBody>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Todavía no hay existencias de este producto en ningún almacén. Entran con una
                  recepción de compra o con un ajuste en Existencias.
                </p>
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Almacén</TH>
                    <TH numeric>En existencia</TH>
                    <TH numeric>Apartado para pedidos</TH>
                  </TR>
                </THead>
                <TBody>
                  {existencias.map((e) => (
                    <TR key={e.almacen}>
                      <TD className="text-[var(--color-text-primary)]">{e.almacen}</TD>
                      <TD numeric>{cantidad(e.disponible, product.unit)}</TD>
                      <TD numeric>{cantidad(e.reservado)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Ficha</CardTitle>
          </CardHeader>
          <CardBody>
            <form action={editarProductoForm} className="space-y-4">
              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
              <input type="hidden" name="id" value={product.id} />

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    defaultValue={product.name}
                    required
                    minLength={2}
                    disabled={!puedeEditar}
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Categoría
                  <select
                    name="categoryId"
                    defaultValue={product.category_id ?? ''}
                    disabled={!puedeEditar}
                    className={inputCls}
                  >
                    <option value="">Sin categoría</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Unidad de venta
                  <input
                    name="unit"
                    defaultValue={product.unit}
                    disabled={!puedeEditar}
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Código de barras
                  <input
                    name="barcode"
                    defaultValue={product.barcode ?? ''}
                    disabled={!puedeEditar}
                    placeholder="7501234567890"
                    className={inputCls}
                  />
                </label>

                {vePrecio ? (
                  <>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Precio de venta
                      <input
                        name="price"
                        defaultValue={product.price}
                        inputMode="decimal"
                        disabled={!editaPrecio}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Costo
                      <input
                        name="cost"
                        defaultValue={product.cost ?? ''}
                        inputMode="decimal"
                        disabled={!editaPrecio}
                        className={inputCls}
                      />
                    </label>
                  </>
                ) : (
                  <p className="sm:col-span-2 text-xs text-[var(--color-text-muted)]">
                    Tu rol &quot;{ctx.roleName}&quot; no tiene acceso a precios ni costos.
                  </p>
                )}

                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Avisar cuando baje de
                  <input
                    name="reorderPoint"
                    defaultValue={
                      product.reorder_point !== null ? String(Number(product.reorder_point)) : ''
                    }
                    inputMode="decimal"
                    disabled={!puedeEditar}
                    placeholder="sin aviso"
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  ITBIS
                  <select
                    name="tasa"
                    defaultValue={String(Number(product.tax_rate))}
                    disabled={!puedeEditar}
                    className={inputCls}
                  >
                    <option value="0.18">18 % (general)</option>
                    <option value="0.16">16 % (aceite, azúcar, café…)</option>
                    <option value="0">Exento (arroz, habichuelas…)</option>
                  </select>
                </label>
              </div>

              {puedeEditar ? (
                <BotonEnvio className="h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  Guardar cambios
                </BotonEnvio>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Tu rol puede ver la ficha pero no modificarla.
                </p>
              )}
            </form>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
