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
import { crearImportForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conciliacion bancaria · REGB ERP' }

interface ImportRow {
  id: string
  bank_name: string
  account_name: string
  period_start: string
  period_end: string
  statement_balance: string
  total: string
  pendientes: string
  created_at: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Conciliacion bancaria (modulo 20): importa el estado y concilia contra lo ya registrado. */
export default async function ConciliacionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'bank-rec')

  const [imports, cuentas] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const i = await tx<ImportRow[]>`
      select imp.id, a.bank_name, a.account_name,
             imp.period_start::text, imp.period_end::text, imp.statement_balance::text,
             imp.created_at::text,
             (select count(*) from public.bank_statement_lines l where l.import_id = imp.id)::text as total,
             (select count(*) from public.bank_statement_lines l
                where l.import_id = imp.id and l.match_status = 'pending')::text as pendientes
      from public.bank_statement_imports imp
      join public.bank_accounts a on a.id = imp.bank_account_id
      where imp.tenant_id = ${ctx.tenantId}
      order by imp.period_end desc, imp.created_at desc
      limit 100`

    const c = await tx<{ id: string; account_name: string; bank_name: string }[]>`
      select id, account_name, bank_name from public.bank_accounts
      where tenant_id = ${ctx.tenantId} and is_active order by bank_name, account_name`

    return [i, c] as const
  })

  const totalPendientes = imports.reduce((a, i) => a + Number(i.pendientes), 0)
  const puedeCrear = exigir(ctx, 'bank-rec', 'bank-rec.import.create').ok
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
    <Shell {...shell} activePath="/conciliacion">
      <div className="space-y-5">
        <PageHeader
          icon="compare_arrows"
          title="Conciliacion bancaria"
          description="Importa el estado de cuenta del banco y concilialo contra lo que ya registraste en tesoreria. El sistema sugiere, tu confirmas."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Imports registrados" value={String(imports.length)} />
          <StatCard
            label="Lineas pendientes"
            value={String(totalPendientes)}
            hint="sin conciliar en total"
          />
          <StatCard label="Cuentas con estado importado" value={String(new Set(imports.map((i) => i.account_name)).size)} />
        </section>

        {imports.length === 0 ? (
          <EmptyState
            icon="compare_arrows"
            title="Todavia no se ha importado ningun estado de cuenta"
            description="Pega las lineas del estado abajo. Necesitas al menos una cuenta bancaria activa en tesoreria."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuenta</TH>
                <TH>Periodo</TH>
                <TH numeric>Saldo del estado</TH>
                <TH numeric>Lineas</TH>
                <TH numeric>Pendientes</TH>
                <TH>Importado</TH>
              </TR>
            </THead>
            <TBody>
              {imports.map((i) => (
                <TR key={i.id}>
                  <TD>
                    <a
                      href={`/conciliacion/${i.id}${qs}`}
                      className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                    >
                      {i.account_name}
                    </a>
                    <span className="block text-xs text-[var(--color-text-muted)]">{i.bank_name}</span>
                  </TD>
                  <TD>
                    {fecha(i.period_start)} – {fecha(i.period_end)}
                  </TD>
                  <TD numeric>
                    <span className="tabular">{money(Number(i.statement_balance))}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{i.total}</span>
                  </TD>
                  <TD numeric>
                    {Number(i.pendientes) > 0 ? (
                      <Badge tone="warning">{i.pendientes}</Badge>
                    ) : (
                      <Badge tone="success">al dia</Badge>
                    )}
                  </TD>
                  <TD>{fecha(i.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeCrear && cuentas.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Importar estado de cuenta</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearImportForm} className="space-y-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Cuenta bancaria
                    <select name="accountId" required className={claseInput}>
                      {cuentas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.account_name} · {c.bank_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Desde
                    <input name="periodStart" type="date" required className={claseInput} />
                  </label>
                  <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Hasta
                    <input name="periodEnd" type="date" required className={claseInput} />
                  </label>
                  <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Saldo del estado
                    <input
                      name="statementBalance"
                      required
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`tabular text-right ${claseInput}`}
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Lineas del estado -una por renglon: fecha,descripcion,monto- (positivo entro, negativo salio)
                  <textarea
                    name="lines"
                    required
                    rows={6}
                    placeholder={'2026-09-01,Deposito de cliente,5000\n2026-09-03,Pago a suplidor,-1200'}
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="upload" size={18} />
                  Importar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        {cuentas.length === 0 && (
          <Card>
            <CardBody className="pt-4 text-sm text-[var(--color-text-secondary)]">
              Necesitas al menos una cuenta bancaria activa en tesoreria para importar un estado.{' '}
              <a href={`/tesoreria${qs}`} className="text-[var(--color-text-link)] hover:underline">
                Registra la primera
              </a>
              .
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
