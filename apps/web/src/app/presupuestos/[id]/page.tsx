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
import { buildBudgetVsActual, type AccountType } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  activarPresupuestoForm,
  cerrarPresupuestoForm,
  ponerLineaPresupuestoForm,
} from '../actions'
import { ESTADO_LINEA_PRESUPUESTO, ESTADO_PRESUPUESTO, MESES } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface PresupuestoHead {
  id: string
  name: string
  fiscal_year: number
  status: string
}

interface CuentaOption {
  id: string
  code: string
  name: string
}

interface FilaCombinada {
  account_id: string
  month: number
  budgeted: string
  total_debit: string
  total_credit: string
  code: string
  name: string
  type: AccountType
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ficha de un presupuesto: sus lineas, el real de contabilidad y el semaforo. */
export default async function PresupuestoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'budgets')

  const [head, cuentas, filas] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<PresupuestoHead[]>`
      select id, name, fiscal_year, status from public.budgets
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return [null, [], []] as const

    const c = await tx<CuentaOption[]>`
      select id, code, name from public.accounts
      where tenant_id = ${ctx.tenantId} and is_active order by code`

    const f = await tx<FilaCombinada[]>`
      with lineas as (
        select account_id, period_month, amount
        from public.budget_lines where budget_id = ${id} and tenant_id = ${ctx.tenantId}
      ),
      real as (
        select je.account_id, extract(month from e.entry_date)::int as mes,
               sum(je.debit) as debito, sum(je.credit) as credito
        from public.journal_entry_lines je
        join public.journal_entries e on e.id = je.entry_id and e.status = 'posted'
        where je.tenant_id = ${ctx.tenantId} and extract(year from e.entry_date) = ${h.fiscal_year}
        group by je.account_id, mes
      ),
      combinado as (
        select coalesce(l.account_id, r.account_id) as account_id,
               coalesce(l.period_month, r.mes) as month,
               coalesce(l.amount, 0) as budgeted,
               coalesce(r.debito, 0) as total_debit,
               coalesce(r.credito, 0) as total_credit
        from líneas l
        full outer join real r on r.account_id = l.account_id and r.mes = l.period_month
      )
      select c.account_id, c.month, c.budgeted::text, c.total_debit::text, c.total_credit::text,
             a.code, a.name, a.type
      from combinado c
      join public.accounts a on a.id = c.account_id
      order by a.code, c.month`

    return [h, c, f] as const
  })

  if (!head) notFound()

  const comparativo = buildBudgetVsActual(
    filas.map((f) => ({
      accountId: f.account_id,
      accountType: f.type,
      month: f.month,
      budgeted: Number(f.budgeted),
      totalDebit: Number(f.total_debit),
      totalCredit: Number(f.total_credit),
    })),
  )
  const porFila = new Map(filas.map((f) => [`${f.account_id}-${f.month}`, f]))

  const totalPresupuestado = comparativo.reduce((a, r) => a + r.budgeted, 0)
  const totalReal = comparativo.reduce((a, r) => a + r.actual, 0)
  const enAlerta = comparativo.filter((r) => r.status !== 'ok').length

  const e = ESTADO_PRESUPUESTO[head.status] ?? { label: head.status, tone: 'neutral' as const }
  const puedeEditar = exigir(ctx, 'budgets', 'budgets.line.set').ok && head.status !== 'closed'
  const puedeCerrar = exigir(ctx, 'budgets', 'budgets.budget.close').ok && head.status !== 'closed'
  const qs = ctx.demoQs

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="budgetId" value={head.id} />
    </>
  )

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/presupuestos">
      <div className="space-y-5">
        <PageHeader
          icon="savings"
          title={head.name}
          description={`Ano fiscal ${head.fiscal_year}`}
          crumbs={[{ label: 'Presupuestos', href: `/presupuestos${qs}` }, { label: head.name }]}
          meta={<Badge tone={e.tone}>{e.label}</Badge>}
          actions={
            <div className="flex items-center gap-2">
              {head.status === 'draft' && puedeEditar && (
                <form action={activarPresupuestoForm}>
                  {campos}
                  <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                    <Icon name="play_arrow" size={18} />
                    Activar
                  </BotonEnvio>
                </form>
              )}
              {puedeCerrar && (
                <form action={cerrarPresupuestoForm}>
                  {campos}
                  <BotonEnvio
                    title="Un presupuesto cerrado queda fijo: no se puede volver a editar"
                    className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]"
                  >
                    <Icon name="lock" size={18} />
                    Cerrar
                  </BotonEnvio>
                </form>
              )}
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Total presupuestado" value={`RD$ ${money(totalPresupuestado)}`} />
          <StatCard label="Total real" value={`RD$ ${money(totalReal)}`} />
          <StatCard
            label="En alerta"
            value={String(enAlerta)}
            hint="cuenta-mes cerca o sobre el limite"
          />
        </section>

        {puedeEditar && (
          <Card>
            <CardHeader>
              <CardTitle>Poner monto planeado</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={ponerLineaPresupuestoForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cuenta
                  <select name="accountId" required className={claseInput}>
                    {cuentas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Mes
                  <select name="month" required className={claseInput}>
                    {MESES.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="check" size={18} />
                  Guardar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Real contra presupuesto</CardTitle>
          </CardHeader>
          <CardBody>
            {comparativo.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Todavía no hay ningún monto planeado ni movimiento contabilizado para este año.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Cuenta</TH>
                    <TH>Mes</TH>
                    <TH numeric>Presupuestado</TH>
                    <TH numeric>Real</TH>
                    <TH numeric>Variacion</TH>
                    <TH>Estado</TH>
                  </TR>
                </THead>
                <TBody>
                  {comparativo.map((r) => {
                    const f = porFila.get(`${r.accountId}-${r.month}`)!
                    const e2 = ESTADO_LINEA_PRESUPUESTO[r.status] ?? {
                      label: r.status,
                      tone: 'neutral' as const,
                    }
                    return (
                      <TR key={`${r.accountId}-${r.month}`}>
                        <TD className="text-[var(--color-text-primary)]">
                          {f.code} · {f.name}
                        </TD>
                        <TD>{MESES[r.month - 1]}</TD>
                        <TD numeric>
                          <span className="tabular">{money(r.budgeted)}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular">{money(r.actual)}</span>
                        </TD>
                        <TD numeric>
                          <span
                            className={`tabular ${
                              r.variance < 0
                                ? 'text-[var(--color-semantic-text-danger)]'
                                : 'text-[var(--color-semantic-text-success)]'
                            }`}
                          >
                            {money(r.variance)}
                            {r.variancePercent !== null && (
                              <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">
                                ({r.variancePercent}%)
                              </span>
                            )}
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={e2.tone}>{e2.label}</Badge>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              El real sale de los asientos ya contabilizados de este año fiscal. Una cuenta con
              gasto real y ningún monto planeado aparece en rojo desde el primer peso.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
