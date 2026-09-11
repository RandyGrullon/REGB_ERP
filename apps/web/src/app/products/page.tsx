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
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  Toolbar,
  ToolbarActions,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { alternarProductoForm, crearProductoForm } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Catalogo · REGB ERP' }

interface ProductRow {
  id: string
  sku: string
  name: string
  unit: string
  price: string
  cost: string | null
  barcode: string | null
  category: string | null
  category_id: string | null
  tax_rate: string
  reorder_point: string | null
  tracks_stock: boolean
  active: boolean
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Catalogo (S18). Nada funciona sin el: inventario cuenta estos productos,
 * los pedidos los venden y las facturas los cobran.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; categoria?: string; inactivos?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'products')

  const q = (params.q ?? '').trim()
  const categoria = params.categoria ?? ''
  const verInactivos = params.inactivos === '1'

  const hayFiltros = q !== '' || categoria !== '' || verInactivos

  const [products, categories, totales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const p = await tx<ProductRow[]>`
      select id, sku, name, unit, price::text, cost::text, barcode, category,
             category_id, tax_rate::text, reorder_point::text, tracks_stock, active
      from public.products
      where tenant_id = ${ctx.tenantId}
        and (${verInactivos} or active)
        and (${q} = '' or name ilike ${'%' + q + '%'} or sku ilike ${'%' + q + '%'}
             or barcode = ${q})
        and (${categoria} = '' or category_id = ${categoria || null}::uuid)
      order by active desc, name
      limit 300`
    const c = await tx<{ id: string; name: string }[]>`
      select id, name from public.product_categories
      where tenant_id = ${ctx.tenantId} order by name`
    const [t] = await tx<{ activos: string; archivados: string }[]>`
      select count(*) filter (where active)     as activos,
             count(*) filter (where not active) as archivados
      from public.products where tenant_id = ${ctx.tenantId}`
    return [
      p,
      c,
      { activos: Number(t?.activos ?? 0), archivados: Number(t?.archivados ?? 0) },
    ] as const
  })

  const puedeCrear = exigir(ctx, 'products', 'products.create').ok
  const puedeEditar = exigir(ctx, 'products', 'products.edit').ok
  // El Almacenista no ve precios de venta (§8): la columna no viaja al HTML.
  const vePrecio = exigir(ctx, 'products', 'products.price.view').ok

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/products">
      <div className="space-y-5">
        <PageHeader
          icon="inventory_2"
          title="Catalogo"
          description="Nada funciona sin el: el inventario cuenta estos productos, la caja los vende y las facturas los cobran."
          actions={
            <>
              <a
                href={`/products/categories${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="sell" size={18} />
                Categorias
              </a>
              <a
                href={`/importar${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="upload_file" size={18} />
                Importar CSV
              </a>
            </>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Activos" value={String(totales.activos)} hint="a la venta" />
          <StatCard
            label="Archivados"
            value={String(totales.archivados)}
            hint="fuera del catalogo"
          />
          <StatCard label="Categorias" value={String(categories.length)} hint="para organizar" />
          <StatCard
            label="Mostrando"
            value={String(products.length)}
            hint={hayFiltros ? 'con los filtros' : 'sin filtrar'}
          />
        </section>

        {/* Filtros por GET: viajan en la URL, sobreviven a recargar y se
            comparten por enlace. El buscador acepta el lector de barras. */}
        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField
            defaultValue={q}
            label="Nombre, codigo o codigo de barras"
            placeholder="arroz, ARZ-001, 750…"
          />
          <FilterSelect label="Categoria" name="categoria" defaultValue={categoria}>
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FilterSelect>
          <label className="flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)]">
            <input type="checkbox" name="inactivos" value="1" defaultChecked={verInactivos} />
            Ver archivados
          </label>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/products${qs}`} />
        </Toolbar>

        {products.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'inventory_2'}
            title={hayFiltros ? 'Nada coincide con ese filtro' : 'Tu catalogo esta vacio'}
            description={
              hayFiltros
                ? 'Prueba con otro texto o quita el filtro de categoria.'
                : 'Crea el primer producto abajo, o sube tu catalogo completo desde Importar.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Codigo</TH>
                <TH>Producto</TH>
                <TH>Categoria</TH>
                <TH>Unidad</TH>
                {vePrecio && <TH numeric>Precio</TH>}
                <TH>ITBIS</TH>
                {puedeEditar && (
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {products.map((p) => (
                <TR key={p.id} className={p.active ? '' : 'opacity-50'}>
                  <TD>
                    <Mono>{p.sku}</Mono>
                  </TD>
                  <TD>
                    <a
                      href={`/products/${p.id}${qs}`}
                      className="font-medium text-[var(--color-text-link)] hover:underline"
                    >
                      {p.name}
                    </a>
                    {!p.active && (
                      <Badge tone="neutral" dot={false} className="ml-2">
                        archivado
                      </Badge>
                    )}
                  </TD>
                  <TD>{p.category ?? '—'}</TD>
                  <TD>{p.unit}</TD>
                  {vePrecio && (
                    <TD numeric>
                      <span className="tabular">{money(Number(p.price))}</span>
                    </TD>
                  )}
                  <TD>
                    {Number(p.tax_rate) === 0 ? (
                      <Badge tone="neutral" dot={false}>
                        exento
                      </Badge>
                    ) : (
                      `${Math.round(Number(p.tax_rate) * 100)}%`
                    )}
                    {!p.tracks_stock && (
                      <Badge tone="info" dot={false} className="ml-2">
                        sin existencias
                      </Badge>
                    )}
                  </TD>
                  {puedeEditar && (
                    <TD>
                      <form action={alternarProductoForm} className="inline">
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="id" value={p.id} />
                        <button
                          type="submit"
                          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                        >
                          {p.active ? 'Archivar' : 'Reactivar'}
                        </button>
                      </form>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo producto</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearProductoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Codigo
                  <input name="sku" required placeholder="ARZ-001" className={inputCls} />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    minLength={2}
                    placeholder="Arroz selecto 5 lb"
                    className={inputCls}
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Categoria
                  <select name="categoryId" className={inputCls} defaultValue="">
                    <option value="">Sin categoria</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Unidad
                  <input name="unit" defaultValue="unidad" className={inputCls} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Precio
                  <input
                    name="price"
                    inputMode="decimal"
                    placeholder="215.00"
                    className={inputCls}
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Costo
                  <input
                    name="cost"
                    inputMode="decimal"
                    placeholder="178.00"
                    className={inputCls}
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Codigo de barras
                  <input name="barcode" placeholder="7501234567890" className={inputCls} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Avisar bajo
                  <input
                    name="reorderPoint"
                    inputMode="decimal"
                    placeholder="10"
                    className={inputCls}
                  />
                </label>
                <label className="flex items-center gap-2 pb-2 text-xs text-[var(--color-text-secondary)]">
                  <input type="checkbox" name="exento" />
                  Exento de ITBIS
                </label>
                <label
                  className="flex items-center gap-2 pb-2 text-xs text-[var(--color-text-secondary)]"
                  title="Para cobrar envio, instalacion o mano de obra: se factura igual, pero no tiene existencias."
                >
                  <input type="checkbox" name="sinStock" />
                  Sin existencias
                </label>
                <button
                  type="submit"
                  className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Crear
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                ¿Tienes muchos? Subelos de una vez desde{' '}
                <a
                  href={`/importar${qs}`}
                  className="text-[var(--color-text-link)] hover:underline"
                >
                  Importar
                </a>
                . El codigo de barras debe ser unico: el lector del POS necesita saber cual cobrar.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
