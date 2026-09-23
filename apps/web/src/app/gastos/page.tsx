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
import { esDeducibleDeItbis, totalPendienteDeReembolso } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { reportarGastoForm } from './actions'
import { CATEGORIA_GASTO, ESTADO_GASTO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Gastos · REGB ERP' }

interface EmpleadoOption {
  id: string
  name: string
}

interface GastoRow {
  id: string
  employee_name: string
  category: string
  expense_date: string
  amount: string
  vendor_name: string | null
  ncf: string | null
  status: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'reimbursed') return 'success'
  if (estado === 'submitted') return 'warning'
  if (estado === 'rejected') return 'danger'
  return 'neutral'
}

const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Gastos & Reembolsos (modulo 68): reportar, aprobar y ver el ITBIS deducible. */
export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'expenses')

  const [empleados, gastos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const e = await tx<EmpleadoOption[]>`
      select id, first_name || ' ' || last_name as name from public.employees
      where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`

    const g = await tx<GastoRow[]>`
      select x.id, e.first_name || ' ' || e.last_name as employee_name, x.category,
             x.expense_date::text, x.amount::text, x.vendor_name, x.ncf, x.status
      from public.expenses x
      join public.employees e on e.id = x.employee_id
      where x.tenant_id = ${ctx.tenantId}
      order by x.created_at desc
      limit 50`

    return [e, g] as const
  })

  const porAprobar = gastos.filter((g) => g.status === 'submitted').length
  const pendienteDeReembolso = totalPendienteDeReembolso(
    gastos.map((g) => ({ status: g.status, amount: Number(g.amount) })),
  )
  const puedeReportar = exigir(ctx, 'expenses', 'expenses.submit').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/gastos">
      <div className="space-y-5">
        <PageHeader
          icon="receipt_long"
          title="Gastos & Reembolsos"
          description="El monto y el proveedor se registran a mano -sin OCR real-. El ITBIS deducible se calcula solo con un NCF fiscal valido."
          actions={
            <a
              href={`/gastos/aprobar${qs}`}
              className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="fact_check" size={18} />
              Aprobar gastos
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Gastos por aprobar" value={String(porAprobar)} />
          <StatCard label="Pendiente de reembolso" value={`RD$ ${money(pendienteDeReembolso)}`} />
        </section>

        {gastos.length === 0 ? (
          <EmptyState
            icon="receipt_long"
            title="Todavia no hay ningun gasto reportado"
            description="Registra el primero abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH>Categoria</TH>
                <TH>Fecha</TH>
                <TH>Proveedor</TH>
                <TH numeric>Monto</TH>
                <TH>ITBIS</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {gastos.map((g) => (
                <TR key={g.id}>
                  <TD className="text-[var(--color-text-primary)]">{g.employee_name}</TD>
                  <TD>{CATEGORIA_GASTO[g.category] ?? g.category}</TD>
                  <TD>{fechaCorta(g.expense_date)}</TD>
                  <TD>{g.vendor_name ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(g.amount))}</span>
                  </TD>
                  <TD>
                    {esDeducibleDeItbis(g.ncf) ? (
                      <Badge tone="success">Deducible</Badge>
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)]">Sin NCF</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={badgeTono(g.status)}>{ESTADO_GASTO[g.status] ?? g.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeReportar && empleados.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Reportar gasto</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={reportarGastoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empleado
                  <select name="employeeId" required className={claseInput}>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Categoria
                  <select name="category" required defaultValue="meals" className={claseInput}>
                    {Object.entries(CATEGORIA_GASTO).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input type="date" name="expenseDate" required className={claseInput} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto (RD$)
                  <input name="amount" required inputMode="decimal" placeholder="0.00" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex min-w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Proveedor
                  <input name="vendorName" className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  RNC del proveedor
                  <input name="vendorTaxId" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  NCF (si tiene)
                  <input name="ncf" placeholder="B0100000001" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nota del recibo
                  <input name="receiptNote" className={claseInput} />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="send" size={18} />
                  Reportar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Sin OCR: el monto y el proveedor se escriben a mano. El ITBIS solo se calcula como
                deducible si el NCF es valido.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
