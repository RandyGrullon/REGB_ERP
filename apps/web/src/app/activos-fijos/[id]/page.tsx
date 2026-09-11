import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import { buildDepreciationSchedule, type DepreciationMethod } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { darDeBajaActivoForm, revaluarActivoForm } from '../actions'
import { CATEGORIA_ACTIVO, ESTADO_ACTIVO, METODO_DEPRECIACION } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface ActivoHead {
  id: string
  code: string
  name: string
  category: string
  acquisition_date: string
  acquisition_cost: string
  salvage_value: string
  useful_life_months: number
  depreciation_method: DepreciationMethod
  status: string
  disposed_at: string | null
  disposed_amount: string | null
  disposed_reason: string | null
  current_basis: string
  accumulated: string
  book_value: string
}

interface DepreciacionRow {
  id: string
  period_date: string
  amount: string
}

interface RevaluoRow {
  id: string
  revaluation_date: string
  old_value: string
  new_value: string
  reason: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ficha de un activo fijo: su calendario de depreciacion, su historial y sus acciones. */
export default async function ActivoFijoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'fixed-assets')

  const [head, depreciaciones, revaluos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<ActivoHead[]>`
      select id, code, name, category, acquisition_date::text, acquisition_cost::text,
             salvage_value::text, useful_life_months, depreciation_method, status,
             disposed_at::text, disposed_amount::text, disposed_reason,
             public.fixed_asset_current_basis(id)::text as current_basis,
             public.fixed_asset_accumulated_depreciation(id)::text as accumulated,
             public.fixed_asset_book_value(id)::text as book_value
      from public.fixed_assets
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return [null, [], []] as const

    const d = await tx<DepreciacionRow[]>`
      select id, period_date::text, amount::text
      from public.fixed_asset_depreciations
      where asset_id = ${id} and tenant_id = ${ctx.tenantId}
      order by period_date desc`

    const r = await tx<RevaluoRow[]>`
      select id, revaluation_date::text, old_value::text, new_value::text, reason
      from public.fixed_asset_revaluations
      where asset_id = ${id} and tenant_id = ${ctx.tenantId}
      order by revaluation_date desc, created_at desc`

    return [h, d, r] as const
  })

  if (!head) notFound()

  const calendario = buildDepreciationSchedule(
    head.depreciation_method,
    Number(head.current_basis),
    Number(head.salvage_value),
    head.useful_life_months,
  )
  const mesesTranscurridos = depreciaciones.length

  const e = ESTADO_ACTIVO[head.status] ?? { label: head.status, tone: 'neutral' as const }
  const puedeRevaluar = exigir(ctx, 'fixed-assets', 'fixed-assets.asset.revalue').ok
  const puedeDarDeBaja = exigir(ctx, 'fixed-assets', 'fixed-assets.asset.dispose').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="assetId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/activos-fijos">
      <div className="space-y-5">
        <PageHeader
          icon="directions_car"
          title={head.name}
          description={`${head.code} · ${CATEGORIA_ACTIVO[head.category] ?? head.category} · ${METODO_DEPRECIACION[head.depreciation_method] ?? head.depreciation_method}`}
          crumbs={[{ label: 'Activos fijos', href: `/activos-fijos${qs}` }, { label: head.name }]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={e.tone}>{e.label}</Badge>
              <span className="text-xs text-[var(--color-text-muted)]">
                Comprado {fecha(head.acquisition_date)}
              </span>
            </div>
          }
        />

        <section aria-label="Valores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Base actual" value={`RD$ ${money(Number(head.current_basis))}`} hint="costo o ultimo revaluo" />
          <StatCard label="Depreciacion acumulada" value={`RD$ ${money(Number(head.accumulated))}`} />
          <StatCard label="Valor en libros" value={`RD$ ${money(Number(head.book_value))}`} />
          <StatCard
            label="Vida util"
            value={`${mesesTranscurridos} / ${head.useful_life_months} meses`}
            hint="periodos depreciados"
          />
        </section>

        {head.status === 'disposed' && (
          <Card>
            <CardBody className="text-sm text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">Dado de baja</strong>{' '}
              {head.disposed_at && `el ${fecha(head.disposed_at)}`}
              {head.disposed_amount && ` por RD$ ${money(Number(head.disposed_amount))}`}
              {head.disposed_reason && ` — ${head.disposed_reason}`}
            </CardBody>
          </Card>
        )}

        {head.status === 'active' && (puedeRevaluar || puedeDarDeBaja) && (
          <div className="grid gap-3 md:grid-cols-2">
            {puedeRevaluar && (
              <Card>
                <CardHeader>
                  <CardTitle>Revaluar</CardTitle>
                </CardHeader>
                <CardBody>
                  <form action={revaluarActivoForm} className="space-y-2">
                    {campos}
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Nuevo valor
                      <input
                        name="newValue"
                        required
                        inputMode="decimal"
                        placeholder="0.00"
                        className={`tabular text-right ${claseInput}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Motivo
                      <input name="reason" required minLength={4} placeholder="Avaluo de perito" className={claseInput} />
                    </label>
                    <BotonEnvio
                      
                      className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="price_change" size={18} />
                      Registrar revaluo
                    </BotonEnvio>
                  </form>
                </CardBody>
              </Card>
            )}

            {puedeDarDeBaja && (
              <Card>
                <CardHeader>
                  <CardTitle>Dar de baja</CardTitle>
                </CardHeader>
                <CardBody>
                  <form action={darDeBajaActivoForm} className="space-y-2">
                    {campos}
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Fecha
                      <input name="disposedAt" type="date" className={claseInput} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Monto recibido
                      <input
                        name="disposedAmount"
                        inputMode="decimal"
                        defaultValue="0"
                        className={`tabular text-right ${claseInput}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Motivo
                      <input name="reason" required minLength={4} placeholder="Vendida a un tercero" className={claseInput} />
                    </label>
                    <BotonEnvio
                      
                      title="No se puede deshacer: un activo dado de baja queda historico"
                      className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="remove_circle" size={18} />
                      Dar de baja
                    </BotonEnvio>
                  </form>
                </CardBody>
              </Card>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Calendario de depreciacion</CardTitle>
          </CardHeader>
          <CardBody>
            {calendario.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Ya no queda nada por depreciar.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Mes</TH>
                      <TH numeric>Depreciacion</TH>
                      <TH numeric>Acumulada</TH>
                      <TH numeric>Valor en libros</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {calendario.map((p) => (
                      <TR key={p.period} className={p.period <= mesesTranscurridos ? '' : 'opacity-60'}>
                        <TD>{p.period}</TD>
                        <TD numeric>
                          <span className="tabular">{money(p.depreciation)}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular">{money(p.accumulated)}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular font-semibold">{money(p.bookValue)}</span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Proyectado desde la base actual -si hubo un revaluo, ya lo incluye-. Los meses ya
              corridos (con fondo normal) coinciden con el historial de abajo.
            </p>
          </CardBody>
        </Card>

        {depreciaciones.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Depreciacion registrada</CardTitle>
            </CardHeader>
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>Periodo</TH>
                    <TH numeric>Monto</TH>
                  </TR>
                </THead>
                <TBody>
                  {depreciaciones.map((d) => (
                    <TR key={d.id}>
                      <TD>{fecha(d.period_date)}</TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(d.amount))}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        )}

        {revaluos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Historial de revaluos</CardTitle>
            </CardHeader>
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH numeric>Antes</TH>
                    <TH numeric>Despues</TH>
                    <TH>Motivo</TH>
                  </TR>
                </THead>
                <TBody>
                  {revaluos.map((r) => (
                    <TR key={r.id}>
                      <TD>{fecha(r.revaluation_date)}</TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(r.old_value))}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular font-semibold">{money(Number(r.new_value))}</span>
                      </TD>
                      <TD>{r.reason}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
