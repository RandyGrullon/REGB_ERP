import {
  Badge,
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
import { countVariance } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { cerrarConteoForm, iniciarConteoForm, registrarLineaConteoForm } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conteos · REGB ERP' }

interface CountLine {
  id: string
  product_id: string
  sku: string
  name: string
  system_qty: string
  counted_qty: string | null
}

interface CountRow {
  id: string
  warehouse_name: string
  status: string
  started_at: string
  closed_at: string | null
}

const inputCls =
  'h-9 w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]'

/** Conteos ciclicos (S19): cuenta una parte cada semana, no cierres el negocio un sabado. */
export default async function CountsPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { abrir?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'inventory')
  const abrir = params.abrir ?? ''

  const [counts, warehouses, lineasAbiertas] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const c = await tx<CountRow[]>`
      select sc.id, w.name as warehouse_name, sc.status,
             sc.started_at::text, sc.closed_at::text
      from public.stock_counts sc
      join public.warehouses w on w.id = sc.warehouse_id
      where sc.tenant_id = ${ctx.tenantId}
      order by sc.started_at desc
      limit 20`
      const w = await tx<{ id: string; name: string }[]>`
      select id, name from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
      const l = abrir
        ? await tx<CountLine[]>`
          select l.id, l.product_id, p.sku, p.name,
                 l.system_qty::text, l.counted_qty::text
          from public.stock_count_lines l
          join public.products p on p.id = l.product_id
          where l.count_id = ${abrir} and l.tenant_id = ${ctx.tenantId}
          order by p.name`
        : []
      return [c, w, l] as const
    },
  )

  const puedeContar = exigir(ctx, 'inventory', 'inventory.count').ok
  const qs = ctx.demoQs
  const conteoAbierto = counts.find((c) => c.id === abrir)

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/inventory/counts">
      <div className="space-y-5">
        <div>
          <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
            <a href={`/inventory${qs}`} className="text-[var(--color-text-link)] hover:underline">
              Existencias
            </a>{' '}
            › Conteos
          </nav>
          <h1 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">
            Conteos ciclicos
          </h1>
        </div>

        {conteoAbierto && (
          <Card>
            <CardHeader>
              <CardTitle>
                Contando en {conteoAbierto.warehouse_name} · abierto{' '}
                {fecha(conteoAbierto.started_at)}
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {lineasAbiertas.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Este almacen no tenia existencias al abrir el conteo.
                </p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Producto</TH>
                      <TH numeric>Sistema dice</TH>
                      <TH numeric>Conteo fisico</TH>
                      <TH numeric>Diferencia</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {lineasAbiertas.map((l) => {
                      const contado = l.counted_qty !== null ? Number(l.counted_qty) : null
                      const diff =
                        contado !== null ? countVariance(contado, Number(l.system_qty)) : null
                      return (
                        <TR key={l.id}>
                          <TD>
                            <Mono>{l.sku}</Mono> {l.name}
                          </TD>
                          <TD numeric>
                            <span className="tabular">{l.system_qty}</span>
                          </TD>
                          <TD numeric>
                            <form action={registrarLineaConteoForm} className="inline">
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="lineId" value={l.id} />
                              <input
                                type="text"
                                name="counted"
                                defaultValue={l.counted_qty ?? ''}
                                inputMode="decimal"
                                placeholder="—"
                                className={inputCls}
                              />{' '}
                              <button
                                type="submit"
                                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]"
                              >
                                Guardar
                              </button>
                            </form>
                          </TD>
                          <TD numeric>
                            {diff !== null && (
                              <Badge
                                tone={diff === 0 ? 'success' : diff < 0 ? 'danger' : 'warning'}
                                dot={false}
                              >
                                {diff > 0 ? '+' : ''}
                                {diff}
                              </Badge>
                            )}
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
              <form action={cerrarConteoForm}>
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="countId" value={conteoAbierto.id} />
                <button
                  type="submit"
                  className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Cerrar conteo y ajustar diferencias
                </button>
              </form>
              <p className="text-xs text-[var(--color-text-muted)]">
                Las lineas sin contar se ignoran: no se asume que "no contado" es "sin diferencia".
              </p>
            </CardBody>
          </Card>
        )}

        {counts.length === 0 ? (
          <EmptyState
            icon="checklist"
            title="Sin conteos todavia"
            description="Empieza uno abajo. No hace falta contar todo: muchos arrancan solo con los productos que mas rotan."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Almacen</TH>
                <TH>Estado</TH>
                <TH>Abierto</TH>
                <TH>Cerrado</TH>
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {counts.map((c) => (
                <TR key={c.id}>
                  <TD>{c.warehouse_name}</TD>
                  <TD>
                    <Badge tone={c.status === 'open' ? 'info' : 'success'}>
                      {c.status === 'open' ? 'Abierto' : 'Cerrado'}
                    </Badge>
                  </TD>
                  <TD>{fecha(c.started_at)}</TD>
                  <TD>{c.closed_at ? fecha(c.closed_at) : '—'}</TD>
                  <TD>
                    {c.status === 'open' && (
                      <a
                        href={`/inventory/counts${qs}${qs ? '&' : '?'}abrir=${c.id}`}
                        className="text-xs text-[var(--color-text-link)] hover:underline"
                      >
                        Continuar
                      </a>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeContar && (
          <Card>
            <CardHeader>
              <CardTitle>Iniciar conteo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={iniciarConteoForm} className="flex flex-wrap items-end gap-3">
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
                <button
                  type="submit"
                  className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  Iniciar
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
