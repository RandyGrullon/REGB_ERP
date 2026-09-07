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
import { saldoPrestamo } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearPrestamoForm, registrarPagoForm } from './actions'
import { ESTADO_PRESTAMO, TIPO_PRESTAMO } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Prestamos & Adelantos · REGB ERP' }

interface EmpleadoOption {
  id: string
  name: string
}

interface PrestamoRow {
  id: string
  employee_name: string
  loan_type: string
  principal: string
  installment_amount: string
  status: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'paid') return 'success'
  if (estado === 'active') return 'warning'
  if (estado === 'cancelled') return 'danger'
  return 'neutral'
}

/** Prestamos & Adelantos (modulo 69): cuota calculada, saldo siempre derivado. */
export default async function BeneficiosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'benefits')

  const [empleados, prestamos, pagosPorPrestamo] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const e = await tx<EmpleadoOption[]>`
        select id, first_name || ' ' || last_name as name from public.employees
        where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`

      const p = await tx<PrestamoRow[]>`
        select l.id, e.first_name || ' ' || e.last_name as employee_name, l.loan_type,
               l.principal::text, l.installment_amount::text, l.status
        from public.benefit_loans l
        join public.employees e on e.id = l.employee_id
        where l.tenant_id = ${ctx.tenantId}
        order by l.created_at desc`

      const pagos = await tx<{ loan_id: string; amount: string }[]>`
        select loan_id, amount::text from public.benefit_loan_payments
        where tenant_id = ${ctx.tenantId}`

      return [e, p, pagos] as const
    },
  )

  const pagosPorId = new Map<string, { amount: number }[]>()
  for (const p of pagosPorPrestamo) {
    const lista = pagosPorId.get(p.loan_id) ?? []
    lista.push({ amount: Number(p.amount) })
    pagosPorId.set(p.loan_id, lista)
  }

  const prestamosConSaldo = prestamos.map((p) => ({
    ...p,
    saldo: saldoPrestamo(Number(p.principal), pagosPorId.get(p.id) ?? []),
  }))

  const activos = prestamosConSaldo.filter((p) => p.status === 'active')
  const totalPendiente = activos.reduce((acc, p) => acc + p.saldo, 0)
  const puedeGestionar = exigir(ctx, 'benefits', 'benefits.manage-loans').ok
  const puedePagar = exigir(ctx, 'benefits', 'benefits.record-payment').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/beneficios">
      <div className="space-y-5">
        <PageHeader
          icon="volunteer_activism"
          title="Prestamos & Adelantos"
          description="El saldo se deriva siempre de los pagos reales -nunca un numero guardado que se desincroniza-."
          actions={
            <a
              href={`/beneficios/planes${qs}`}
              className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="health_and_safety" size={18} />
              Planes & Inscripciones
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Prestamos activos" value={String(activos.length)} />
          <StatCard label="Saldo pendiente total" value={`RD$ ${money(totalPendiente)}`} />
        </section>

        {prestamosConSaldo.length === 0 ? (
          <EmptyState
            icon="volunteer_activism"
            title="Todavia no hay ningun prestamo"
            description="Registra el primero abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH>Tipo</TH>
                <TH numeric>Principal</TH>
                <TH numeric>Cuota</TH>
                <TH numeric>Saldo</TH>
                <TH>Estado</TH>
                {puedePagar && (
                  <TH>
                    <span className="sr-only">Accion</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {prestamosConSaldo.map((p) => (
                <TR key={p.id}>
                  <TD className="text-[var(--color-text-primary)]">{p.employee_name}</TD>
                  <TD>{TIPO_PRESTAMO[p.loan_type] ?? p.loan_type}</TD>
                  <TD numeric>
                    <span className="tabular">{money(Number(p.principal))}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{money(Number(p.installment_amount))}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular font-semibold text-[var(--color-text-primary)]">
                      {money(p.saldo)}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={badgeTono(p.status)}>{ESTADO_PRESTAMO[p.status] ?? p.status}</Badge>
                  </TD>
                  {puedePagar && (
                    <TD>
                      {p.status === 'active' && (
                        <form action={registrarPagoForm} className="flex items-center gap-1.5">
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="loanId" value={p.id} />
                          <input type="hidden" name="source" value="payroll" />
                          <input
                            type="hidden"
                            name="amount"
                            value={Math.min(p.saldo, Number(p.installment_amount))}
                          />
                          <button
                            type="submit"
                            className="flex h-8 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                          >
                            <Icon name="payments" size={14} />
                            Registrar cuota
                          </button>
                        </form>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && empleados.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo prestamo o adelanto</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearPrestamoForm} className="flex flex-wrap items-end gap-3">
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
                  Tipo
                  <select name="loanType" required defaultValue="loan" className={claseInput}>
                    {Object.entries(TIPO_PRESTAMO).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto (RD$)
                  <input name="principal" required inputMode="decimal" placeholder="0.00" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cuotas
                  <input name="installments" required inputMode="numeric" placeholder="12" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tasa mensual (opcional)
                  <input name="monthlyRate" inputMode="decimal" placeholder="0" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha de inicio
                  <input type="date" name="startDate" required className={claseInput} />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nota (opcional)
                  <input name="notes" className={claseInput} />
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="send" size={18} />
                  Registrar
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                La cuota se calcula sola -sin interes por defecto, el caso tipico de un prestamo interno-.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
