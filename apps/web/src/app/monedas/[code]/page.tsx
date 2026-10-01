import { notFound } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { exchangeDifference } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface Moneda {
  code: string
  name: string
  symbol: string
}

interface TasaRow {
  rate_date: string
  rate: string
}

const fechaCorta = (iso: string | undefined) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : undefined

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

interface DiffParams extends DemoParams {
  amount?: string
}

/** Historial de tasa de una moneda, con una calculadora rapida de diferencia cambiaria. */
export default async function HistorialTasaPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<DiffParams>
}) {
  const { code } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'multicurrency')
  const currencyCode = code.toUpperCase()

  const [moneda, tasas] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [m] = await tx<
      Moneda[]
    >`select code, name, symbol from public.currencies where code = ${currencyCode}`
    if (!m) return [null, []] as const

    const t = await tx<TasaRow[]>`
      select rate_date::text, rate::text from public.exchange_rates
      where tenant_id = ${ctx.tenantId} and currency_code = ${currencyCode}
      order by rate_date desc`

    return [m, t] as const
  })

  if (!moneda) notFound()

  const primera = tasas[tasas.length - 1]
  const ultima = tasas[0]
  const monto = Number(sp.amount ?? 0)
  const diferencia =
    primera && ultima && sp.amount && Number.isFinite(monto)
      ? exchangeDifference(monto, Number(primera.rate), Number(ultima.rate))
      : null

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/monedas">
      <div className="space-y-5">
        <PageHeader
          icon="currency_exchange"
          title={moneda.name}
          description={moneda.code}
          crumbs={[{ label: 'Monedas', href: `/monedas${qs}` }, { label: moneda.name }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Tasas capturadas" value={String(tasas.length)} />
          <StatCard
            label="Tasa más reciente"
            value={ultima ? `RD$ ${money(Number(ultima.rate))}` : '—'}
            hint={fechaCorta(ultima?.rate_date)}
          />
          <StatCard
            label="Tasa más antigua"
            value={primera ? `RD$ ${money(Number(primera.rate))}` : '—'}
            hint={fechaCorta(primera?.rate_date)}
          />
        </section>

        {tasas.length >= 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Diferencia cambiaria: primera tasa vs. la más reciente</CardTitle>
            </CardHeader>
            <CardBody>
              <form method="get" className="flex flex-wrap items-end gap-3">
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto en {moneda.code}
                  <input
                    name="amount"
                    defaultValue={sp.amount ?? ''}
                    inputMode="decimal"
                    placeholder="1000.00"
                    className="tabular h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-right text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  Calcular
                </BotonEnvio>
              </form>
              {diferencia !== null && (
                <p
                  className={`mt-3 text-lg font-semibold ${
                    diferencia >= 0
                      ? 'text-[var(--color-semantic-text-success)]'
                      : 'text-[var(--color-semantic-text-danger)]'
                  }`}
                >
                  <span className="tabular">
                    {diferencia >= 0 ? 'Ganancia' : 'Pérdida'} de RD$ {money(Math.abs(diferencia))}
                  </span>
                </p>
              )}
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Compara el valor en pesos del mismo monto en {moneda.code} entre la tasa de{' '}
                {fechaCorta(primera?.rate_date)} y la de {fechaCorta(ultima?.rate_date)}.
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Historial de tasas</CardTitle>
          </CardHeader>
          <CardBody>
            {tasas.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Todavía no se ha capturado ninguna tasa para {moneda.code}. Captúrala en Monedas.
              </p>
            ) : (
              <Table className="min-w-[420px]">
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH numeric>Tasa (RD$)</TH>
                    <TH numeric>Cambio</TH>
                  </TR>
                </THead>
                <TBody>
                  {tasas.map((t, i) => {
                    // `tasas` viene de la más reciente a la más vieja.
                    const anterior = tasas[i + 1]
                    const cambio = anterior ? Number(t.rate) - Number(anterior.rate) : null
                    return (
                      <TR key={t.rate_date}>
                        <TD className="whitespace-nowrap">{fechaCorta(t.rate_date)}</TD>
                        <TD numeric>
                          <span className="tabular">{money(Number(t.rate))}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular text-[var(--color-text-muted)]">
                            {cambio === null
                              ? '—'
                              : `${cambio > 0 ? '+' : cambio < 0 ? '−' : ''}${money(Math.abs(cambio))}`}
                          </span>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
