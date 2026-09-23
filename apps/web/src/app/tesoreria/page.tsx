import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
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
import { crearCuentaForm, registrarTransferenciaForm } from './actions'
import { TIPO_CUENTA, TIPO_MOVIMIENTO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tesoreria · REGB ERP' }

interface CuentaRow {
  id: string
  bank_name: string
  account_name: string
  account_number: string
  account_type: string
  opening_balance: string
  is_active: boolean
  saldo: string
  movimientos: string
}

interface MovimientoRow {
  id: string
  type: string
  amount: string
  description: string
  transaction_date: string
  account_name: string
  bank_name: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Tesoreria (modulo 19): cuanto efectivo hay, en que cuenta y como se movio. */
export default async function TesoreriaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'treasury')

  const [cuentas, ultimos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<CuentaRow[]>`
      select a.id, a.bank_name, a.account_name, a.account_number, a.account_type,
             a.opening_balance::text, a.is_active,
             public.bank_account_balance(a.id)::text as saldo,
             (select count(*) from public.bank_transactions t
               where t.bank_account_id = a.id)::text as movimientos
      from public.bank_accounts a
      where a.tenant_id = ${ctx.tenantId}
      order by a.is_active desc, a.bank_name, a.account_name`

    const m = await tx<MovimientoRow[]>`
      select t.id, t.type, t.amount::text, t.description, t.transaction_date::text,
             a.account_name, a.bank_name
      from public.bank_transactions t
      join public.bank_accounts a on a.id = t.bank_account_id
      where t.tenant_id = ${ctx.tenantId}
      order by t.transaction_date desc, t.created_at desc
      limit 12`

    return [c, m] as const
  })

  const activas = cuentas.filter((c) => c.is_active)
  const efectivo = activas.reduce((a, c) => a + Number(c.saldo), 0)
  const puedeCrear = exigir(ctx, 'treasury', 'treasury.account.create').ok
  const puedeTransferir = exigir(ctx, 'treasury', 'treasury.transfer.create').ok
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
    </>
  )

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/tesoreria">
      <div className="space-y-5">
        <PageHeader
          icon="account_balance"
          title="Tesoreria"
          description="Cuanto efectivo tienes de verdad, en que cuenta esta y como se movio. Un movimiento registrado no se edita ni se borra: se corrige con el contrario."
          actions={
            <a
              href={`/tesoreria/flujo${qs}`}
              className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="ssid_chart" size={18} />
              Flujo de caja
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Efectivo disponible"
            value={`RD$ ${money(efectivo)}`}
            hint={`en ${activas.length} cuenta${activas.length === 1 ? '' : 's'}`}
          />
          <StatCard label="Cuentas activas" value={String(activas.length)} hint="dando saldo" />
          <StatCard
            label="Movimientos"
            value={String(cuentas.reduce((a, c) => a + Number(c.movimientos), 0))}
            hint="registrados en total"
          />
        </section>

        {cuentas.length === 0 ? (
          <EmptyState
            icon="account_balance"
            title="Todavia no hay ninguna cuenta bancaria"
            description="Registra la primera abajo con su saldo actual. De ahi en adelante el saldo lo calcula el sistema solo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuenta</TH>
                <TH>Banco</TH>
                <TH>Numero</TH>
                <TH>Tipo</TH>
                <TH numeric>Saldo inicial</TH>
                <TH numeric>Movimientos</TH>
                <TH numeric>Saldo actual</TH>
              </TR>
            </THead>
            <TBody>
              {cuentas.map((c) => {
                const saldo = Number(c.saldo)
                return (
                  <TR key={c.id} className={c.is_active ? '' : 'opacity-50'}>
                    <TD>
                      <a
                        href={`/tesoreria/${c.id}${qs}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {c.account_name}
                      </a>
                      {!c.is_active && (
                        <Badge tone="neutral" dot={false}>
                          Inactiva
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-[var(--color-text-primary)]">{c.bank_name}</TD>
                    <TD>
                      <Mono>{c.account_number}</Mono>
                    </TD>
                    <TD>{TIPO_CUENTA[c.account_type] ?? c.account_type}</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(c.opening_balance))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{c.movimientos}</span>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular font-semibold ${
                          saldo < 0 ? 'text-[var(--color-semantic-text-danger)]' : ''
                        }`}
                      >
                        {money(saldo)}
                      </span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeTransferir && activas.length >= 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Transferir entre cuentas propias</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarTransferenciaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Desde
                  <select name="fromAccountId" required className={claseInput}>
                    {activas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.account_name} · {c.bank_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Hacia
                  <select name="toAccountId" required className={claseInput}>
                    {activas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.account_name} · {c.bank_name}
                      </option>
                    ))}
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
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Concepto
                  <input name="description" placeholder="Opcional" className={claseInput} />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="swap_horiz" size={18} />
                  Transferir
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Se registran las dos mitades juntas -salida en el origen, entrada en el destino-.
                Nunca queda una transferencia con un solo lado.
              </p>
            </CardBody>
          </Card>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar cuenta bancaria</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCuentaForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Banco
                  <input name="bankName" required placeholder="Banco Popular" className={claseInput} />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre de la cuenta
                  <input name="accountName" required placeholder="Operativa" className={claseInput} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Numero
                  <input name="accountNumber" required placeholder="123-456789-0" className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select name="accountType" className={claseInput}>
                    <option value="checking">Corriente</option>
                    <option value="savings">Ahorros</option>
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Saldo actual
                  <input
                    name="openingBalance"
                    inputMode="decimal"
                    defaultValue="0"
                    title="El saldo que tiene hoy esa cuenta en el banco. De aqui en adelante lo calcula el sistema."
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        {ultimos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Ultimos movimientos</CardTitle>
            </CardHeader>
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Cuenta</TH>
                    <TH>Concepto</TH>
                    <TH>Tipo</TH>
                    <TH numeric>Monto</TH>
                  </TR>
                </THead>
                <TBody>
                  {ultimos.map((m) => {
                    const t = TIPO_MOVIMIENTO[m.type] ?? {
                      label: m.type,
                      tone: 'neutral' as const,
                      entra: true,
                    }
                    return (
                      <TR key={m.id}>
                        <TD>{fecha(m.transaction_date)}</TD>
                        <TD className="text-[var(--color-text-primary)]">{m.account_name}</TD>
                        <TD>{m.description}</TD>
                        <TD>
                          <Badge tone={t.tone}>{t.label}</Badge>
                        </TD>
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
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
