import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
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
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Volantes de nomina · REGB ERP' }

interface PeriodoOption {
  id: string
  period_start: string
  period_end: string
  status: string
}

interface VolanteRow {
  employee_name: string
  position: string
  paid_days: string | null
  gross_salary: string
  reimbursements: string
  tss_deduction: string
  income_tax: string
  other_deductions: string
  net_salary: string
}

interface ReportsParams extends DemoParams {
  period?: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Volantes de nomina (modulo 62): el desglose de TSS, ISR y neto de cada empleado en un periodo ya procesado. */
export default async function ReportesPayrollPage({
  searchParams,
}: {
  searchParams: Promise<ReportsParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'payroll')

  const [periodos, volantes] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const p = await tx<PeriodoOption[]>`
      select id, period_start::text, period_end::text, status
      from public.payroll_periods
      where tenant_id = ${ctx.tenantId} and status <> 'draft'
      order by period_end desc`

    const periodId = params.period ?? p[0]?.id
    if (!periodId) return [p, []] as const

    const v = await tx<VolanteRow[]>`
      select emp.first_name || ' ' || emp.last_name as employee_name, emp.position,
             l.paid_days::text, l.gross_salary::text, l.reimbursements::text,
             l.tss_deduction::text, l.income_tax::text,
             l.other_deductions::text, l.net_salary::text
      from public.payroll_lines l
      join public.employees emp on emp.id = l.employee_id
      where l.tenant_id = ${ctx.tenantId} and l.period_id = ${periodId}
      order by emp.last_name`

    return [p, v] as const
  })

  const qs = ctx.demoQs
  const periodoActivo = params.period ?? periodos[0]?.id

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const totalBruto = volantes.reduce((a, v) => a + Number(v.gross_salary), 0)
  const totalTss = volantes.reduce((a, v) => a + Number(v.tss_deduction), 0)
  const totalIsr = volantes.reduce((a, v) => a + Number(v.income_tax), 0)
  const totalNeto = volantes.reduce((a, v) => a + Number(v.net_salary), 0)

  return (
    <Shell {...shell} activePath="/payroll">
      <div className="space-y-5">
        <PageHeader
          icon="receipt_long"
          title="Volantes de nomina"
          description="El desglose de TSS, ISR y neto de cada empleado en un periodo ya procesado."
          crumbs={[{ label: 'Nomina', href: `/payroll${qs}` }, { label: 'Volantes' }]}
        />

        {periodos.length === 0 ? (
          <EmptyState
            icon="receipt_long"
            title="Todavia no hay ningun periodo procesado"
            description="Procesa un periodo desde /payroll/run para ver sus volantes aqui."
          />
        ) : (
          <>
            <nav aria-label="Periodos" className="flex flex-wrap gap-2">
              {periodos.map((p) => (
                <a
                  key={p.id}
                  href={`/payroll/reports?period=${p.id}${qs ? `&${qs.slice(1)}` : ''}`}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    p.id === periodoActivo
                      ? 'border-[var(--color-brand-bright)] bg-[var(--color-brand-soft)] text-[var(--color-brand-bright)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]'
                  }`}
                >
                  {fecha(p.period_start)} – {fecha(p.period_end)}
                </a>
              ))}
            </nav>

            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Total bruto" value={`RD$ ${money(totalBruto)}`} />
              <StatCard label="TSS retenida" value={`RD$ ${money(totalTss)}`} />
              <StatCard label="ISR retenido" value={`RD$ ${money(totalIsr)}`} />
              <StatCard label="Total neto" value={`RD$ ${money(totalNeto)}`} />
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Volante por empleado</CardTitle>
              </CardHeader>
              <CardBody>
                <Table>
                  <THead>
                    <TR>
                      <TH>Empleado</TH>
                      <TH>Cargo</TH>
                      <TH numeric>Dias</TH>
                      <TH numeric>Bruto</TH>
                      <TH numeric>Reembolsos</TH>
                      <TH numeric>TSS</TH>
                      <TH numeric>ISR</TH>
                      <TH numeric>Prestamos y otros</TH>
                      <TH numeric>Neto</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {volantes.map((v, i) => (
                      <TR key={i}>
                        <TD className="text-[var(--color-text-primary)]">{v.employee_name}</TD>
                        <TD>{v.position}</TD>
                        <TD numeric>
                          <span className="tabular">{v.paid_days === null ? '—' : Number(v.paid_days)}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular">{money(Number(v.gross_salary))}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular">{money(Number(v.reimbursements))}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular text-[var(--color-semantic-text-warning)]">
                            {money(Number(v.tss_deduction))}
                          </span>
                        </TD>
                        <TD numeric>
                          <span className="tabular text-[var(--color-semantic-text-warning)]">
                            {money(Number(v.income_tax))}
                          </span>
                        </TD>
                        <TD numeric>
                          <span className="tabular">{money(Number(v.other_deductions))}</span>
                        </TD>
                        <TD numeric>
                          <span className="tabular font-semibold">{money(Number(v.net_salary))}</span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </Shell>
  )
}
