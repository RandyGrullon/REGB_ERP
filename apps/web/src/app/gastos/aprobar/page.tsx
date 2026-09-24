import { EmptyState, Icon, PageHeader, TBody, TD, TH, THead, TR, Table } from '@regb/ui'
import { esDeducibleDeItbis } from '@regb/operations'
import { asUser } from '@/lib/db'
import { exigir, modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { reembolsarGastoForm, resolverGastoForm } from '../actions'
import { CATEGORIA_GASTO } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Aprobar gastos · REGB ERP' }

interface GastoRow {
  id: string
  employee_name: string
  category: string
  expense_date: string
  amount: string
  vendor_name: string | null
  ncf: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Cola de aprobacion y reembolso de gastos (modulo 68). */
export default async function AprobarGastosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  // La ruta pide aprobar, como declara el manifest: con solo `expenses.view`
  // se veian los botones y cada clic terminaba en error.
  const { ctx, shell } = await modulePage(params, 'expenses', 'expenses.approve')
  const puedeReembolsar = exigir(ctx, 'expenses', 'expenses.reimburse').ok

  const [porAprobar, porReembolsar, periodos] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const a = await tx<GastoRow[]>`
      select x.id, e.first_name || ' ' || e.last_name as employee_name, x.category,
             x.expense_date::text, x.amount::text, x.vendor_name, x.ncf
      from public.expenses x
      join public.employees e on e.id = x.employee_id
      where x.tenant_id = ${ctx.tenantId} and x.status = 'submitted'
      order by x.created_at`

      const r = await tx<GastoRow[]>`
      select x.id, e.first_name || ' ' || e.last_name as employee_name, x.category,
             x.expense_date::text, x.amount::text, x.vendor_name, x.ncf
      from public.expenses x
      join public.employees e on e.id = x.employee_id
      where x.tenant_id = ${ctx.tenantId} and x.status = 'approved'
      order by x.decided_at`

      // Solo las nominas que todavia se pueden pagar: una procesada ya no
      // suma nada (la base lo rechaza) y ofrecerla era invitar al error.
      const p = await tx<{ id: string; period_start: string; period_end: string }[]>`
      select id, period_start::text, period_end::text from public.payroll_periods
      where tenant_id = ${ctx.tenantId} and status = 'draft'
      order by period_start limit 12`

      return [
        a,
        r,
        p.map((x) => ({
          id: x.id,
          label: `Nómina ${fechaCorta(x.period_start)} – ${fechaCorta(x.period_end)}`,
        })),
      ] as const
    },
  )

  const qs = ctx.demoQs

  const claseInput =
    'h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/gastos">
      <div className="space-y-5">
        <PageHeader
          icon="fact_check"
          title="Aprobar gastos"
          description="Reportado → aprobado o rechazado. Aprobado → reembolsado. Por nómina, el reembolso se suma al neto de la nómina en borrador que elijas, sin TSS ni ISR. Una vez rechazado o reembolsado, el gasto queda fijo."
          crumbs={[{ label: 'Gastos', href: `/gastos${qs}` }, { label: 'Aprobar' }]}
        />

        <div>
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
            Por aprobar
          </h2>
          {porAprobar.length === 0 ? (
            <EmptyState icon="fact_check" title="No hay ningún gasto por aprobar" description="" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Empleado</TH>
                  <TH>Categoría</TH>
                  <TH>Fecha</TH>
                  <TH>Proveedor</TH>
                  <TH numeric>Monto</TH>
                  <TH>
                    <span className="sr-only">Acción</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {porAprobar.map((g) => (
                  <TR key={g.id}>
                    <TD className="text-[var(--color-text-primary)]">{g.employee_name}</TD>
                    <TD>{CATEGORIA_GASTO[g.category] ?? g.category}</TD>
                    <TD>{fechaCorta(g.expense_date)}</TD>
                    <TD>{g.vendor_name ?? '—'}</TD>
                    <TD numeric>
                      <span className="tabular">RD$ {money(Number(g.amount))}</span>
                    </TD>
                    <TD>
                      <div className="flex gap-1.5">
                        <form action={resolverGastoForm}>
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="recordId" value={g.id} />
                          <input type="hidden" name="decision" value="approved" />
                          <BotonEnvio className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-3 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                            <Icon name="check" size={14} />
                            Aprobar
                          </BotonEnvio>
                        </form>
                        <form action={resolverGastoForm}>
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="recordId" value={g.id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <BotonEnvio className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                            <Icon name="close" size={14} />
                            Rechazar
                          </BotonEnvio>
                        </form>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
            Aprobados, por reembolsar
          </h2>
          {porReembolsar.length === 0 ? (
            <EmptyState
              icon="payments"
              title="No hay ningún gasto aprobado sin reembolsar"
              description=""
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Empleado</TH>
                  <TH>Categoría</TH>
                  <TH numeric>Monto</TH>
                  <TH>ITBIS</TH>
                  {puedeReembolsar && <TH>Reembolsar</TH>}
                </TR>
              </THead>
              <TBody>
                {porReembolsar.map((g) => (
                  <TR key={g.id}>
                    <TD className="text-[var(--color-text-primary)]">{g.employee_name}</TD>
                    <TD>{CATEGORIA_GASTO[g.category] ?? g.category}</TD>
                    <TD numeric>
                      <span className="tabular">RD$ {money(Number(g.amount))}</span>
                    </TD>
                    <TD className="text-xs text-[var(--color-text-muted)]">
                      {esDeducibleDeItbis(g.ncf) ? 'Deducible' : 'Sin NCF'}
                    </TD>
                    {puedeReembolsar && (
                      <TD>
                        <form
                          action={reembolsarGastoForm}
                          className="flex flex-wrap items-center gap-1.5"
                        >
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="recordId" value={g.id} />
                          {/* Un solo campo: como se paga y, si es por nomina, en cual. */}
                          <select
                            name="destino"
                            required
                            defaultValue="transfer"
                            aria-label="Cómo se reembolsa"
                            className={claseInput}
                          >
                            <option value="transfer">Por transferencia</option>
                            <option value="cash">En efectivo</option>
                            {periodos.map((p) => (
                              <option key={p.id} value={`payroll:${p.id}`}>
                                En la {p.label.toLowerCase()}
                              </option>
                            ))}
                          </select>
                          <BotonEnvio className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                            <Icon name="payments" size={14} />
                            Reembolsar
                          </BotonEnvio>
                        </form>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>
    </Shell>
  )
}
