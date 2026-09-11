import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { convertFromBase, convertToBase, daysSinceRate, findApplicableRate } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ponerTasaForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Monedas · REGB ERP' }

interface Moneda {
  code: string
  name: string
  symbol: string
}

interface TasaRow {
  currency_code: string
  rate_date: string
  rate: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

interface ConvertParams extends DemoParams {
  amount?: string
  currency?: string
  direction?: string
  date?: string
}

/** Monedas (modulo 26): historial de tasas capturadas a mano, y una calculadora de conversion. */
export default async function MonedasPage({
  searchParams,
}: {
  searchParams: Promise<ConvertParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'multicurrency')

  const [monedas, tasas] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const m = await tx<Moneda[]>`
      select code, name, symbol from public.currencies
      where code <> 'DOP' and is_active order by code`
    const t = await tx<TasaRow[]>`
      select currency_code, rate_date::text, rate::text from public.exchange_rates
      where tenant_id = ${ctx.tenantId}
      order by rate_date`
    return [m, t] as const
  })

  const porMoneda = new Map<string, TasaRow[]>()
  for (const t of tasas) {
    const lista = porMoneda.get(t.currency_code) ?? []
    lista.push(t)
    porMoneda.set(t.currency_code, lista)
  }

  const hoy = new Date()
  const puedeCapturar = exigir(ctx, 'multicurrency', 'multicurrency.rate.set').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  // ── Calculadora de conversion (GET, sin estado en el servidor) ─────────
  let resultado: string | null = null
  if (params.amount && params.currency) {
    const monto = Number(params.amount)
    const fecha = params.date ? new Date(`${params.date}T12:00:00`) : hoy
    const historial = (porMoneda.get(params.currency) ?? []).map((t) => ({
      rateDate: new Date(`${t.rate_date.slice(0, 10)}T12:00:00`),
      rate: Number(t.rate),
    }))
    const tasa = findApplicableRate(historial, fecha)
    if (Number.isFinite(monto) && tasa !== null) {
      const moneda = monedas.find((m) => m.code === params.currency)
      resultado =
        params.direction === 'from_dop'
          ? `${moneda?.symbol ?? ''} ${money(convertFromBase(monto, tasa))} (tasa ${money(tasa)})`
          : `RD$ ${money(convertToBase(monto, tasa))} (tasa ${money(tasa)})`
    } else if (tasa === null) {
      resultado = 'no-hay-tasa'
    }
  }

  return (
    <Shell {...shell} activePath="/monedas">
      <div className="space-y-5">
        <PageHeader
          icon="currency_exchange"
          title="Monedas"
          description="Historial de tasas capturadas a mano -sin conexion automatica a una API del Banco Central- y una calculadora de conversion."
        />

        <Table>
          <THead>
            <TR>
              <TH>Moneda</TH>
              <TH numeric>Ultima tasa</TH>
              <TH>Fecha</TH>
              <TH>Antiguedad</TH>
            </TR>
          </THead>
          <TBody>
            {monedas.map((m) => {
              const historial = porMoneda.get(m.code) ?? []
              const ultima = historial[historial.length - 1]
              const dias = ultima ? daysSinceRate(new Date(`${ultima.rate_date.slice(0, 10)}T12:00:00`), hoy) : null
              return (
                <TR key={m.code}>
                  <TD>
                    <a
                      href={`/monedas/${m.code}${qs}`}
                      className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                    >
                      {m.name}
                    </a>
                    <span className="block text-xs text-[var(--color-text-muted)]">{m.code}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular font-semibold">
                      {ultima ? `RD$ ${money(Number(ultima.rate))}` : '—'}
                    </span>
                  </TD>
                  <TD>{ultima ? ultima.rate_date.slice(0, 10) : '—'}</TD>
                  <TD>
                    {dias === null ? (
                      <Badge tone="neutral">sin tasa</Badge>
                    ) : dias > 7 ? (
                      <Badge tone="warning">{dias} dias</Badge>
                    ) : (
                      <Badge tone="success">{dias} dias</Badge>
                    )}
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>

        <Card>
          <CardHeader>
            <CardTitle>Calculadora de conversion</CardTitle>
          </CardHeader>
          <CardBody>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Monto
                <input
                  name="amount"
                  defaultValue={params.amount ?? ''}
                  required
                  inputMode="decimal"
                  placeholder="100.00"
                  className={`tabular text-right ${claseInput}`}
                />
              </label>
              <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Moneda
                <select name="currency" defaultValue={params.currency ?? monedas[0]?.code} className={claseInput}>
                  {monedas.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Direccion
                <select name="direction" defaultValue={params.direction ?? 'to_dop'} className={claseInput}>
                  <option value="to_dop">A pesos (RD$)</option>
                  <option value="from_dop">De pesos (RD$) a la moneda</option>
                </select>
              </label>
              <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                Fecha
                <input name="date" type="date" defaultValue={params.date ?? ''} className={claseInput} />
              </label>
              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
              <BotonEnvio
                
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                <Icon name="calculate" size={18} />
                Convertir
              </BotonEnvio>
            </form>
            {resultado === 'no-hay-tasa' && (
              <p className="mt-3 text-sm text-[var(--color-semantic-text-danger)]">
                No hay ninguna tasa capturada en o antes de esa fecha para esa moneda.
              </p>
            )}
            {resultado && resultado !== 'no-hay-tasa' && (
              <p className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">
                <span className="tabular">{resultado}</span>
              </p>
            )}
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Sin tasa exacta de esa fecha, se usa la mas reciente conocida ANTES de ella -nunca una
              futura-.
            </p>
          </CardBody>
        </Card>

        {puedeCapturar && (
          <Card>
            <CardHeader>
              <CardTitle>Capturar tasa</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={ponerTasaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Moneda
                  <select name="currencyCode" required className={claseInput}>
                    {monedas.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input name="rateDate" type="date" className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tasa (RD$)
                  <input
                    name="rate"
                    required
                    inputMode="decimal"
                    placeholder="58.50"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="add" size={18} />
                  Guardar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
