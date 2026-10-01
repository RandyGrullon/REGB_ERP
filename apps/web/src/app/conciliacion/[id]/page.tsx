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
import { reconciliationSummary, suggestMatches, type BankTransactionInput } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  confirmarMatchForm,
  desconciliarForm,
  ignorarLineaForm,
  reactivarLineaForm,
} from '../actions'
import { ESTADO_LINEA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface ImportHead {
  id: string
  bank_account_id: string
  bank_name: string
  account_name: string
  period_start: string
  period_end: string
  statement_balance: string
}

interface LineaRow {
  id: string
  line_date: string
  description: string
  amount: string
  match_status: 'pending' | 'matched' | 'ignored'
  matched_transaction_id: string | null
  matched_description: string | null
  matched_date: string | null
}

interface TransaccionCandidata {
  id: string
  type: string
  amount: string
  description: string
  transaction_date: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const TIPO_LABEL: Record<string, string> = {
  deposit: 'Depósito',
  withdrawal: 'Retiro',
  transfer_in: 'Entrada por transferencia',
  transfer_out: 'Salida por transferencia',
}

/** Ficha de un import: sus lineas, la sugerencia del sistema y la confirmacion humana. */
export default async function ImportConciliacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'bank-rec')

  const [head, lineas, candidatas] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<ImportHead[]>`
      select imp.id, imp.bank_account_id, a.bank_name, a.account_name,
             imp.period_start::text, imp.period_end::text, imp.statement_balance::text
      from public.bank_statement_imports imp
      join public.bank_accounts a on a.id = imp.bank_account_id
      where imp.id = ${id} and imp.tenant_id = ${ctx.tenantId}`
    if (!h) return [null, [], []] as const

    const l = await tx<LineaRow[]>`
      select l.id, l.line_date::text, l.description, l.amount::text, l.match_status,
             l.matched_transaction_id,
             t.description as matched_description, t.transaction_date::text as matched_date
      from public.bank_statement_lines l
      left join public.bank_transactions t on t.id = l.matched_transaction_id
      where l.import_id = ${id} and l.tenant_id = ${ctx.tenantId}
      order by l.line_date, l.created_at`

    const c = await tx<TransaccionCandidata[]>`
      select t.id, t.type, t.amount::text, t.description, t.transaction_date::text
      from public.bank_transactions t
      where t.tenant_id = ${ctx.tenantId} and t.bank_account_id = ${h.bank_account_id}
        and not exists (
          select 1 from public.bank_statement_lines sl where sl.matched_transaction_id = t.id
        )
      order by t.transaction_date`

    return [h, l, c] as const
  })

  if (!head) notFound()

  const candidatasInput: BankTransactionInput[] = candidatas.map((c) => ({
    id: c.id,
    amount: Number(c.amount),
    type: c.type as BankTransactionInput['type'],
    transactionDate: new Date(`${c.transaction_date.slice(0, 10)}T12:00:00`),
  }))

  const pendientes = lineas.filter((l) => l.match_status === 'pending')
  const sugerencias = new Map(
    suggestMatches(
      pendientes.map((l) => ({
        id: l.id,
        amount: Number(l.amount),
        lineDate: new Date(`${l.line_date.slice(0, 10)}T12:00:00`),
      })),
      candidatasInput,
    ).map((s) => [s.lineId, s.transactionId]),
  )

  const resumen = reconciliationSummary(
    lineas.map((l) => ({ status: l.match_status, amount: Number(l.amount) })),
  )

  const puedeConfirmar = exigir(ctx, 'bank-rec', 'bank-rec.match.confirm').ok
  const puedeRegistrar = exigir(ctx, 'treasury', 'treasury.transaction.record').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="importId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/conciliacion">
      <div className="space-y-5">
        <PageHeader
          icon="compare_arrows"
          title={`${head.account_name} · ${head.bank_name}`}
          description={`Período ${fecha(head.period_start)} – ${fecha(head.period_end)}`}
          crumbs={[
            { label: 'Conciliación', href: `/conciliacion${qs}` },
            { label: head.account_name },
          ]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Saldo del estado"
            value={`RD$ ${money(Number(head.statement_balance))}`}
          />
          <StatCard label="Conciliadas" value={String(resumen.matched)} hint="con su movimiento" />
          <StatCard
            label="Pendientes"
            value={String(resumen.pending)}
            hint={`RD$ ${money(resumen.pendingAmount)} sin explicar`}
          />
          <StatCard label="Ignoradas" value={String(resumen.ignored)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Líneas del estado</CardTitle>
          </CardHeader>
          <CardBody>
            <Table className="md:min-w-[860px]">
              <THead>
                <TR>
                  <TH className="hidden md:table-cell">Fecha</TH>
                  <TH>Descripción</TH>
                  <TH numeric>Monto</TH>
                  <TH className="hidden md:table-cell">Estado</TH>
                  <TH className="hidden md:table-cell">Emparejar con</TH>
                </TR>
              </THead>
              <TBody>
                {lineas.map((l) => {
                  const e = ESTADO_LINEA[l.match_status]
                  const monto = Number(l.amount)
                  const sugerido = sugerencias.get(l.id)
                  const emparejar = (
                    <>
                      {l.match_status === 'matched' && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            {l.matched_description}
                            {l.matched_date && ` · ${fecha(l.matched_date)}`}
                          </span>
                          {puedeConfirmar && (
                            <form action={desconciliarForm}>
                              {campos}
                              <input type="hidden" name="lineId" value={l.id} />
                              <BotonEnvio
                                title="Deshacer esta conciliación"
                                className="text-xs text-[var(--color-text-link)] hover:underline"
                              >
                                Deshacer
                              </BotonEnvio>
                            </form>
                          )}
                        </div>
                      )}
                      {l.match_status === 'ignored' && puedeConfirmar && (
                        <form action={reactivarLineaForm}>
                          {campos}
                          <input type="hidden" name="lineId" value={l.id} />
                          <BotonEnvio className="text-xs text-[var(--color-text-link)] hover:underline">
                            Reactivar
                          </BotonEnvio>
                        </form>
                      )}
                      {l.match_status === 'pending' && puedeConfirmar && (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={confirmarMatchForm} className="flex items-center gap-1">
                            {campos}
                            <input type="hidden" name="lineId" value={l.id} />
                            <select
                              name="transactionId"
                              defaultValue={sugerido ?? ''}
                              aria-label={`Movimiento para emparejar con ${l.description}`}
                              className="h-8 max-w-56 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                            >
                              <option value="" disabled>
                                Elige un movimiento
                              </option>
                              {candidatas.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {fecha(c.transaction_date)} · {TIPO_LABEL[c.type] ?? c.type} ·{' '}
                                  {money(Number(c.amount))} · {c.description.slice(0, 30)}
                                </option>
                              ))}
                            </select>
                            <BotonEnvio
                              title={
                                sugerido
                                  ? 'Sugerido por el sistema'
                                  : 'Confirmar el emparejamiento elegido'
                              }
                              className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                            >
                              <Icon name="check" size={14} />
                              {sugerido ? 'Confirmar' : 'Conciliar'}
                            </BotonEnvio>
                          </form>
                          <form action={ignorarLineaForm}>
                            {campos}
                            <input type="hidden" name="lineId" value={l.id} />
                            <BotonEnvio
                              title="Esta línea nunca va a tener pareja"
                              className="text-xs text-[var(--color-text-muted)] hover:underline"
                            >
                              Ignorar
                            </BotonEnvio>
                          </form>
                          {!sugerido && puedeRegistrar && (
                            <a
                              href={`/tesoreria/${head.bank_account_id}${qs}`}
                              title="Si el banco lo cobró y nadie lo anotó, regístralo en la cuenta y vuelve a conciliarlo"
                              className="text-xs text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                            >
                              Registrarlo en la cuenta
                            </a>
                          )}
                        </div>
                      )}
                    </>
                  )
                  return (
                    <TR key={l.id}>
                      <TD className="hidden whitespace-nowrap md:table-cell">
                        {fecha(l.line_date)}
                      </TD>
                      <TD className="text-[var(--color-text-primary)]">
                        {l.description}
                        {/* En el teléfono: fecha, estado y cómo emparejarla, aquí mismo. */}
                        <div className="mt-1 space-y-2 md:hidden">
                          <span className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                            {fecha(l.line_date)}
                            <Badge tone={e?.tone ?? 'neutral'}>{e?.label ?? l.match_status}</Badge>
                          </span>
                          <div>{emparejar}</div>
                        </div>
                      </TD>
                      <TD numeric>
                        <span
                          className={`tabular whitespace-nowrap ${
                            monto > 0
                              ? 'text-[var(--color-semantic-text-success)]'
                              : 'text-[var(--color-semantic-text-warning)]'
                          }`}
                        >
                          {monto > 0 ? '+' : '−'}
                          {money(Math.abs(monto))}
                        </span>
                      </TD>
                      <TD className="hidden md:table-cell">
                        <Badge tone={e?.tone ?? 'neutral'}>{e?.label ?? l.match_status}</Badge>
                      </TD>
                      <TD className="hidden md:table-cell">{emparejar}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              La sugerencia es por monto, signo y fecha cercana, pero nunca es automática del todo:
              cada conciliación la confirma una persona. Una línea que no tiene pareja en tesorería
              (como una comisión del banco) se registra primero en la cuenta, y después se concilia.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
