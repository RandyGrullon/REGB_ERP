import { notFound } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { precioPorVolumen } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearEntradaForm } from '../actions'
import { ALCANCE_LISTA } from '../estados'

export const dynamic = 'force-dynamic'

interface ListaHead {
  id: string
  name: string
  scope: string
}

interface EntradaRow {
  id: string
  product_name: string
  min_quantity: string
  unit_price: string
}

interface ProductoOption {
  id: string
  name: string
  price: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Cuotas de precio de una lista (modulo 41): cual precio aplica segun la cantidad. */
export default async function ListaPrecioDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'price-lists')

  const { lista, entradas, productos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [head] = await tx<ListaHead[]>`
      select id, name, scope from public.price_lists where id = ${id} and tenant_id = ${ctx.tenantId}`

    if (!head) return { lista: null, entradas: [], productos: [] }

    const e = await tx<EntradaRow[]>`
      select pe.id, p.name as product_name, pe.min_quantity::text, pe.unit_price::text
      from public.price_list_entries pe
      join public.products p on p.id = pe.product_id
      where pe.tenant_id = ${ctx.tenantId} and pe.price_list_id = ${id}
      order by p.name, pe.min_quantity`

    const p = await tx<ProductoOption[]>`
      select id, name, price::text from public.products
      where tenant_id = ${ctx.tenantId} and active order by name`

    return { lista: head, entradas: e, productos: p }
  })

  if (!lista) notFound()

  const entradasPorProducto = new Map<string, EntradaRow[]>()
  for (const e of entradas) {
    const l = entradasPorProducto.get(e.product_name) ?? []
    l.push(e)
    entradasPorProducto.set(e.product_name, l)
  }

  const puedeGestionar = exigir(ctx, 'price-lists', 'price-lists.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/listas-precio">
      <div className="space-y-5">
        <PageHeader
          icon="sell"
          title={lista.name}
          description={`Alcance: ${ALCANCE_LISTA[lista.scope] ?? lista.scope}`}
          crumbs={[{ label: 'Listas de precio', href: `/listas-precio${qs}` }, { label: lista.name }]}
        />

        {entradas.length === 0 ? (
          <EmptyState icon="sell" title="Todavia no hay ninguna cuota de precio" description="Registra la primera abajo." />
        ) : (
          Array.from(entradasPorProducto.entries()).map(([nombreProducto, cuotas]) => (
            <Card key={nombreProducto}>
              <CardHeader>
                <CardTitle>{nombreProducto}</CardTitle>
              </CardHeader>
              <CardBody>
                <Table>
                  <THead>
                    <TR>
                      <TH numeric>Desde cuantas unidades</TH>
                      <TH numeric>Precio unitario</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {cuotas.map((c) => (
                      <TR key={c.id}>
                        <TD numeric>
                          <span className="tabular">{c.min_quantity}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular font-semibold text-[var(--color-text-primary)]">
                            RD$ {money(Number(c.unit_price))}
                          </span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Ejemplo: pedir {Math.round(Number(cuotas[cuotas.length - 1]!.min_quantity) * 1.5)} unidades usaria
                  RD${' '}
                  {money(
                    precioPorVolumen(
                      cuotas.map((c) => ({
                        minQuantity: Number(c.min_quantity),
                        unitPrice: Number(c.unit_price),
                      })),
                      Math.round(Number(cuotas[cuotas.length - 1]!.min_quantity) * 1.5),
                    ) ?? 0,
                  )}
                  .
                </p>
              </CardBody>
            </Card>
          ))
        )}

        {puedeGestionar && productos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva cuota de precio</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearEntradaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="listId" value={lista.id} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto
                  <select name="productId" required className={claseInput}>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (base RD$ {money(Number(p.price))})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desde cuantas unidades
                  <input name="minQuantity" defaultValue="1" inputMode="decimal" required className={`tabular ${claseInput}`} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Precio unitario
                  <input name="unitPrice" inputMode="decimal" required className={`tabular ${claseInput}`} />
                </label>
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="add" size={14} />
                  Agregar cuota
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
