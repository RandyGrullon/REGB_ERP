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
    const [m] = await tx<Moneda[]>`select code, name, symbol from public.currencies where code = ${currencyCode}`
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
            label="Tasa mas reciente"
            value={ultima ? `RD$ ${money(Number(ultima.rate))}` : '—'}
            hint={ultima?.rate_date.slice(0, 10)}
          />
          <StatCard
            label="Tasa mas antigua"
            value={primera ? `RD$ ${money(Number(primera.rate))}` : '—'}
            hint={primera?.rate_date.slice(0, 10)}
          />
        </section>

        {tasas.length >= 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Diferencia cambiaria: primera tasa vs. la mas reciente</CardTitle>
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
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
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
                    {diferencia >= 0 ? 'Ganancia' : 'Perdida'} de RD$ {money(Math.abs(diferencia))}
                  </span>
                </p>
              )}
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Compara el valor en pesos del mismo monto en {moneda.code} entre la tasa de{' '}
                {primera?.rate_date.slice(0, 10)} y la de {ultima?.rate_date.slice(0, 10)}.
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
                Todavia no se ha capturado ninguna tasa para {moneda.code}.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH numeric>Tasa (RD$)</TH>
                  </TR>
                </THead>
                <TBody>
                  {tasas.map((t) => (
                    <TR key={t.rate_date}>
                      <TD>{t.rate_date.slice(0, 10)}</TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(t.rate))}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
