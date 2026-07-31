import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
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
import { crearCategoriaForm } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Categorias · REGB ERP' }

interface CategoryRow {
  id: string
  name: string
  parent_id: string | null
  parent_name: string | null
  product_count: string
}

const inputCls =
  'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

/** Categorias del catalogo (S18). Un solo nivel de jerarquia a proposito. */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'products')

  const categories = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<CategoryRow[]>`
      select c.id, c.name, c.parent_id, p.name as parent_name,
             (select count(*) from public.products pr
               where pr.category_id = c.id and pr.active) as product_count
      from public.product_categories c
      left join public.product_categories p on p.id = c.parent_id
      where c.tenant_id = ${ctx.tenantId}
      order by coalesce(p.name, c.name), c.parent_id nulls first, c.name`,
  )

  const puedeGestionar = exigir(ctx, 'products', 'products.categories.manage').ok
  const raices = categories.filter((c) => c.parent_id === null)
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/products/categories">
      <div className="max-w-3xl space-y-5">
        <div>
          <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
            <a href={`/products${qs}`} className="text-[var(--color-text-link)] hover:underline">
              Catalogo
            </a>{' '}
            › Categorias
          </nav>
          <h1 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">Categorias</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Sirven para filtrar el catalogo y agrupar los reportes. Con un nivel de subcategorias
            basta para casi cualquier negocio.
          </p>
        </div>

        {categories.length === 0 ? (
          <EmptyState
            icon="🏷️"
            title="Todavia no hay categorias"
            description="Crea la primera abajo. Si importaste un CSV con columna de categoria, ya deberian aparecer aqui."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Categoria</TH>
                <TH>Dentro de</TH>
                <TH numeric>Productos</TH>
              </TR>
            </THead>
            <TBody>
              {categories.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium text-[var(--color-text-primary)]">
                    {c.parent_name && <span className="text-[var(--color-text-muted)]">↳ </span>}
                    {c.name}
                  </TD>
                  <TD>{c.parent_name ?? '—'}</TD>
                  <TD numeric>
                    <a
                      href={`/products${qs}${qs ? '&' : '?'}categoria=${c.id}`}
                      className="tabular text-[var(--color-text-link)] hover:underline"
                    >
                      {c.product_count}
                    </a>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva categoria</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCategoriaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    minLength={2}
                    placeholder="Lacteos"
                    className={inputCls}
                  />
                </label>
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Dentro de
                  <select name="parentId" defaultValue="" className={inputCls}>
                    <option value="">Categoria principal</option>
                    {raices.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
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
