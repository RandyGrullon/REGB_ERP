import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
  StatCard,
} from '@regb/ui'
import { calculatePayrollLine, TASAS_TSS_REFERENCIA_2024 } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { procesarPeriodoForm } from '../actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Procesar nomina · REGB ERP' }

interface PeriodoDraft {
  id: string
  period_start: string
  period_end: string
  pay_date: string
}

interface EmpleadoPendiente {
  id: string
  name: string
  salary: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Procesar nomina (modulo 62): calcula TSS e ISR de cada empleado activo pendiente en el periodo mas reciente en borrador. */
export default async function ProcesarNominaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'payroll')

  const [periodo, pendientes] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [p] = await tx<PeriodoDraft[]>`
      select id, period_start::text, period_end::text, pay_date::text
      from public.payroll_periods
      where tenant_id = ${ctx.tenantId} and status = 'draft'
      order by period_end
      limit 1`
    if (!p) return [null, []] as const

    const e = await tx<EmpleadoPendiente[]>`
      select emp.id, emp.first_name || ' ' || emp.last_name as name, emp.salary::text
      from public.employees emp
      where emp.tenant_id = ${ctx.tenantId} and emp.status = 'active'
        and not exists (
          select 1 from public.payroll_lines l
          where l.period_id = ${p.id} and l.employee_id = emp.id)
      order by emp.last_name`

    return [p, e] as const
  })

  const puedeProcesar = exigir(ctx, 'payroll', 'payroll.run').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const previsualizacion = pendientes.map((e) => ({
    ...e,
    calculo: calculatePayrollLine(Number(e.salary), TASAS_TSS_REFERENCIA_2024),
  }))
  const totalNeto = previsualizacion.reduce((a, e) => a + e.calculo.netSalary, 0)

  return (
    <Shell {...shell} activePath="/payroll">
      <div className="space-y-5">
        <PageHeader
          icon="calculate"
          title="Procesar nomina"
          description="Calcula TSS e ISR de cada empleado activo que todavia no tiene linea en el periodo mas antiguo en borrador."
          crumbs={[{ label: 'Nomina', href: `/payroll${qs}` }, { label: 'Procesar' }]}
        />

        {!periodo ? (
          <EmptyState
            icon="calculate"
            title="No hay ningun periodo en borrador"
            description="Crea uno desde la pantalla de Nomina antes de procesar."
          />
        ) : (
          <>
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatCard label="Periodo" value={`${fecha(periodo.period_start)} – ${fecha(periodo.period_end)}`} />
              <StatCard label="Empleados pendientes" value={String(pendientes.length)} />
              <StatCard label="Neto proyectado" value={`RD$ ${money(totalNeto)}`} />
            </section>

            {pendientes.length === 0 ? (
              <EmptyState
                icon="check_circle"
                title="Ya no queda nadie pendiente en este periodo"
                description="Todos los empleados activos ya tienen su linea calculada."
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Previsualizacion</CardTitle>
                </CardHeader>
                <CardBody>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                          <th className="py-2">Empleado</th>
                          <th className="py-2 text-right">Bruto</th>
                          <th className="py-2 text-right">TSS</th>
                          <th className="py-2 text-right">ISR</th>
                          <th className="py-2 text-right">Neto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previsualizacion.map((e) => (
                          <tr key={e.id} className="border-b border-[var(--color-border-subtle)]">
                            <td className="py-2 text-[var(--color-text-primary)]">{e.name}</td>
                            <td className="py-2 text-right tabular">{money(e.calculo.grossSalary)}</td>
                            <td className="py-2 text-right tabular text-[var(--color-semantic-text-warning)]">
                              {money(e.calculo.tssDeduction)}
                            </td>
                            <td className="py-2 text-right tabular text-[var(--color-semantic-text-warning)]">
                              {money(e.calculo.incomeTax)}
                            </td>
                            <td className="py-2 text-right tabular font-semibold">
                              {money(e.calculo.netSalary)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {puedeProcesar && (
                    <form action={procesarPeriodoForm} className="mt-4">
                      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                      <input type="hidden" name="periodId" value={periodo.id} />
                      <button
                        type="submit"
                        title="Calcula y guarda estas lineas. El periodo queda fijo despues de procesar."
                        className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Icon name="check" size={18} />
                        Procesar periodo
                      </button>
                    </form>
                  )}
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}
