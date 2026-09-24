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
import { totalAportePatronal } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { cancelarInscripcionForm, crearInscripcionForm } from '../actions'
import { ESTADO_INSCRIPCION } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Planes & Inscripciones · REGB ERP' }

interface EmpleadoOption {
  id: string
  name: string
}

interface InscripcionRow {
  id: string
  employee_name: string
  plan_name: string
  employee_contribution: string
  employer_contribution: string
  status: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Planes & Inscripciones (modulo 69): quien esta inscrito, cuanto aporta cada quien. */
export default async function PlanesPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'benefits')

  const [empleados, inscripciones] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const e = await tx<EmpleadoOption[]>`
      select id, first_name || ' ' || last_name as name from public.employees
      where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`

    const i = await tx<InscripcionRow[]>`
      select b.id, e.first_name || ' ' || e.last_name as employee_name, b.plan_name,
             b.employee_contribution::text, b.employer_contribution::text, b.status
      from public.benefit_enrollments b
      join public.employees e on e.id = b.employee_id
      where b.tenant_id = ${ctx.tenantId}
      order by b.created_at desc`

    return [e, i] as const
  })

  const costoMensual = totalAportePatronal(
    inscripciones.map((i) => ({
      status: i.status,
      employer_contribution: Number(i.employer_contribution),
    })),
  )
  const puedeGestionar = exigir(ctx, 'benefits', 'benefits.manage-enrollments').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/beneficios">
      <div className="space-y-5">
        <PageHeader
          icon="health_and_safety"
          title="Planes & Inscripciones"
          description="Quién está inscrito en cada plan y cuánto aportan el empleado y la empresa. Los reclamos se tramitan con la aseguradora."
          crumbs={[
            { label: 'Prestamos & Adelantos', href: `/beneficios${qs}` },
            { label: 'Planes' },
          ]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Costo patronal mensual" value={`RD$ ${money(costoMensual)}`} />
        </section>

        {inscripciones.length === 0 ? (
          <EmptyState
            icon="health_and_safety"
            title="Todavia no hay ninguna inscripcion"
            description="Registra la primera abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH>Plan</TH>
                <TH numeric>Aporte empleado</TH>
                <TH numeric>Aporte patronal</TH>
                <TH>Estado</TH>
                {puedeGestionar && (
                  <TH>
                    <span className="sr-only">Acción</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {inscripciones.map((i) => (
                <TR key={i.id}>
                  <TD className="text-[var(--color-text-primary)]">{i.employee_name}</TD>
                  <TD>{i.plan_name}</TD>
                  <TD numeric>
                    <span className="tabular">{money(Number(i.employee_contribution))}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{money(Number(i.employer_contribution))}</span>
                  </TD>
                  <TD>
                    <Badge tone={i.status === 'active' ? 'success' : 'neutral'}>
                      {ESTADO_INSCRIPCION[i.status] ?? i.status}
                    </Badge>
                  </TD>
                  {puedeGestionar && (
                    <TD>
                      {i.status === 'active' && (
                        <form action={cancelarInscripcionForm}>
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="recordId" value={i.id} />
                          <BotonEnvio className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                            <Icon name="cancel" size={14} />
                            Cancelar
                          </BotonEnvio>
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
              <CardTitle>Nueva inscripcion</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearInscripcionForm} className="flex flex-wrap items-end gap-3">
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
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Plan
                  <input name="planName" required className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Aporte empleado
                  <input
                    name="employeeContribution"
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Aporte patronal
                  <input
                    name="employerContribution"
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vigente desde
                  <input type="date" name="effectiveDate" required className={claseInput} />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="send" size={18} />
                  Inscribir
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
