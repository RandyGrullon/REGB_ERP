import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  Mono,
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
import { registrarMovimientoForm } from '../actions'
import { TIPO_CUENTA, TIPO_MOVIMIENTO } from '../estados'

export const dynamic = 'force-dynamic'

interface CuentaHead {
  id: string
  bank_name: string
  account_name: string
  account_number: string
  account_type: string
  opening_balance: string
  is_active: boolean
}

interface MovimientoRow {
  id: string
  type: string
  amount: string
  description: string
  reference: string | null
  transaction_date: string
  created_by_name: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ficha de una cuenta bancaria: su saldo, su historial y como registrar un movimiento. */
export default async function CuentaBancariaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'treasury')

  const [head, movimientos, saldoRow] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<CuentaHead[]>`
      select id, bank_name, account_name, account_number, account_type,
             opening_balance::text, is_active
      from public.bank_accounts
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return [null, [], null] as const

    const m = await tx<MovimientoRow[]>`
      select t.id, t.type, t.amount::text, t.description, t.reference,
             t.transaction_date::text, up.display_name as created_by_name
      from public.bank_transactions t
      left join public.user_profiles up
        on up.tenant_id = t.tenant_id and up.user_id = t.created_by
      where t.bank_account_id = ${id} and t.tenant_id = ${ctx.tenantId}
      order by t.transaction_date desc, t.created_at desc
      limit 200`

    const [s] = await tx<{ saldo: string }[]>`
      select public.bank_account_balance(${id})::text as saldo`

    return [h, m, s] as const
  })

  if (!head) notFound()

  const saldo = Number(saldoRow?.saldo ?? 0)
  const entradas = movimientos
    .filter((m) => TIPO_MOVIMIENTO[m.type]?.entra)
    .reduce((a, m) => a + Number(m.amount), 0)
  const salidas = movimientos
    .filter((m) => TIPO_MOVIMIENTO[m.type] && !TIPO_MOVIMIENTO[m.type]!.entra)
    .reduce((a, m) => a + Number(m.amount), 0)

  const puedeMover = exigir(ctx, 'treasury', 'treasury.transaction.record').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/tesoreria">
      <div className="space-y-5">
        <PageHeader
          icon="account_balance"
          title={head.account_name}
          description={`${head.bank_name} · ${TIPO_CUENTA[head.account_type] ?? head.account_type}`}
          crumbs={[{ label: 'Tesoreria', href: `/tesoreria${qs}` }, { label: head.account_name }]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Mono>{head.account_number}</Mono>
              {!head.is_active && <Badge tone="neutral">Inactiva</Badge>}
            </div>
          }
        />

        <section aria-label="Saldo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Saldo actual"
            value={`RD$ ${money(saldo)}`}
            hint={saldo < 0 ? 'sobregirada' : 'disponible'}
          />
          <StatCard
            label="Saldo inicial"
            value={`RD$ ${money(Number(head.opening_balance))}`}
            hint="al registrar la cuenta"
          />
          <StatCard label="Entradas" value={`RD$ ${money(entradas)}`} hint="depositos y traspasos" />
          <StatCard label="Salidas" value={`RD$ ${money(salidas)}`} hint="retiros y traspasos" />
        </section>

        {puedeMover && head.is_active && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar movimiento</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarMovimientoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="accountId" value={head.id} />
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select name="type" className={claseInput}>
                    <option value="deposit">Deposito</option>
                    <option value="withdrawal">Retiro</option>
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Concepto
                  <input
                    name="description"
                    required
                    minLength={3}
                    placeholder="Deposito de la venta del dia"
                    className={claseInput}
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Referencia
                  <input name="reference" placeholder="No. de cheque" className={claseInput} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input name="transactionDate" type="date" className={claseInput} />
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="add" size={18} />
                  Registrar
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Queda fijo: un movimiento no se edita ni se borra. Si te equivocas, registra el
                movimiento contrario y los dos quedan en el historial.
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Historial</CardTitle>
          </CardHeader>
          <CardBody>
            {movimientos.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Esta cuenta todavia no tiene movimientos.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Concepto</TH>
                    <TH>Tipo</TH>
                    <TH>Referencia</TH>
                    <TH>Registrado por</TH>
                    <TH numeric>Monto</TH>
                  </TR>
                </THead>
                <TBody>
                  {movimientos.map((m) => {
                    const t = TIPO_MOVIMIENTO[m.type] ?? {
                      label: m.type,
                      tone: 'neutral' as const,
                      entra: true,
                    }
                    return (
                      <TR key={m.id}>
                        <TD>{fecha(m.transaction_date)}</TD>
                        <TD className="text-[var(--color-text-primary)]">{m.description}</TD>
                        <TD>
                          <Badge tone={t.tone}>{t.label}</Badge>
                        </TD>
                        <TD>{m.reference ?? '—'}</TD>
                        <TD>{m.created_by_name ?? '—'}</TD>
                        <TD numeric>
                          <span
                            className={`tabular ${
                              t.entra
                                ? 'text-[var(--color-semantic-text-success)]'
                                : 'text-[var(--color-semantic-text-warning)]'
                            }`}
                          >
                            {t.entra ? '+' : '−'}
                            {money(Number(m.amount))}
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
