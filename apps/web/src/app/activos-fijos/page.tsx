import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
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
import { correrDepreciacionForm, crearActivoForm } from './actions'
import { CATEGORIA_ACTIVO, ESTADO_ACTIVO, METODO_DEPRECIACION } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Activos fijos · REGB ERP' }

interface ActivoRow {
  id: string
  code: string
  name: string
  category: string
  depreciation_method: string
  acquisition_cost: string
  status: string
  book_value: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Activos fijos (modulo 21): alta, depreciacion, revaluo y baja. */
export default async function ActivosFijosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'fixed-assets')

  const [activos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const a = await tx<ActivoRow[]>`
      select id, code, name, category, depreciation_method, acquisition_cost::text,
             status, public.fixed_asset_book_value(id)::text as book_value
      from public.fixed_assets
      where tenant_id = ${ctx.tenantId}
      order by status, name
      limit 200`
    return [a] as const
  })

  const activosActivos = activos.filter((a) => a.status === 'active')
  const valorLibrosTotal = activosActivos.reduce((acc, a) => acc + Number(a.book_value), 0)
  const puedeCrear = exigir(ctx, 'fixed-assets', 'fixed-assets.asset.create').ok
  const puedeDepreciar = exigir(ctx, 'fixed-assets', 'fixed-assets.depreciation.run').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/activos-fijos">
      <div className="space-y-5">
        <PageHeader
          icon="directions_car"
          title="Activos fijos"
          description="Vehiculos, equipos y demas activos: su valor en libros, su depreciacion y su historial."
          actions={
            puedeDepreciar && (
              <form action={correrDepreciacionForm} className="flex items-center gap-2">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="period" value={new Date().toISOString().slice(0, 10)} />
                <button
                  type="submit"
                  title="Corre la depreciacion de este periodo para todos los activos activos. Correrla dos veces no duplica el gasto."
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="event_repeat" size={18} />
                  Correr depreciacion de hoy
                </button>
              </form>
            )
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Valor en libros"
            value={`RD$ ${money(valorLibrosTotal)}`}
            hint={`${activosActivos.length} activos activos`}
          />
          <StatCard label="Total de activos" value={String(activos.length)} />
          <StatCard
            label="Dados de baja"
            value={String(activos.filter((a) => a.status === 'disposed').length)}
          />
        </section>

        {activos.length === 0 ? (
          <EmptyState
            icon="directions_car"
            title="Todavia no hay ningun activo fijo registrado"
            description="Registra el primero abajo con su costo, su vida util y su metodo de depreciacion."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Activo</TH>
                <TH>Categoria</TH>
                <TH>Metodo</TH>
                <TH numeric>Costo</TH>
                <TH numeric>Valor en libros</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {activos.map((a) => {
                const e = ESTADO_ACTIVO[a.status] ?? { label: a.status, tone: 'neutral' as const }
                return (
                  <TR key={a.id} className={a.status === 'disposed' ? 'opacity-50' : ''}>
                    <TD>
                      <a
                        href={`/activos-fijos/${a.id}${qs}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {a.name}
                      </a>
                      <span className="block text-xs text-[var(--color-text-muted)]">{a.code}</span>
                    </TD>
                    <TD>{CATEGORIA_ACTIVO[a.category] ?? a.category}</TD>
                    <TD>{METODO_DEPRECIACION[a.depreciation_method] ?? a.depreciation_method}</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(a.acquisition_cost))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(a.book_value))}</span>
                    </TD>
                    <TD>
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar activo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearActivoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Codigo
                  <input name="code" required placeholder="VEH-001" className={claseInput} />
                </label>
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="name" required placeholder="Camioneta de reparto" className={claseInput} />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Categoria
                  <select name="category" defaultValue="other" className={claseInput}>
                    {Object.entries(CATEGORIA_ACTIVO).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha de compra
                  <input name="acquisitionDate" type="date" required className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Costo
                  <input
                    name="acquisitionCost"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Valor de rescate
                  <input
                    name="salvageValue"
                    inputMode="decimal"
                    defaultValue="0"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vida util (meses)
                  <input
                    name="usefulLifeMonths"
                    required
                    inputMode="numeric"
                    placeholder="60"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Metodo
                  <select name="depreciationMethod" defaultValue="straight_line" className={claseInput}>
                    {Object.entries(METODO_DEPRECIACION).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="add" size={18} />
                  Registrar
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
