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
import { yearsOfService } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearContratoForm, darDeBajaEmpleadoForm } from '../actions'
import { ESTADO_EMPLEADO, TIPO_CONTRATO } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface EmpleadoHead {
  id: string
  code: string
  first_name: string
  last_name: string
  national_id: string | null
  position: string
  department: string | null
  hire_date: string
  salary: string
  status: string
  termination_date: string | null
  termination_reason: string | null
  manager_name: string | null
  email: string | null
  phone: string | null
}

interface ContratoRow {
  id: string
  contract_type: string
  start_date: string
  end_date: string | null
  salary: string
  position: string
  is_active: boolean
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ficha de un empleado: su expediente y su historial de contratos. */
export default async function EmpleadoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'employees')

  const [head, contratos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<EmpleadoHead[]>`
      select e.id, e.code, e.first_name, e.last_name, e.national_id, e.position, e.department,
             e.hire_date::text, e.salary::text, e.status,
             e.termination_date::text, e.termination_reason,
             m.first_name || ' ' || m.last_name as manager_name,
             e.email, e.phone
      from public.employees e
      left join public.employees m on m.id = e.manager_id
      where e.id = ${id} and e.tenant_id = ${ctx.tenantId}`
    if (!h) return [null, []] as const

    const c = await tx<ContratoRow[]>`
      select id, contract_type, start_date::text, end_date::text, salary::text, position, is_active
      from public.employee_contracts
      where employee_id = ${id} and tenant_id = ${ctx.tenantId}
      order by start_date desc, created_at desc`

    return [h, c] as const
  })

  if (!head) notFound()

  const hoy = new Date()
  const anos = yearsOfService(new Date(`${head.hire_date.slice(0, 10)}T12:00:00`), hoy)
  const e = ESTADO_EMPLEADO[head.status] ?? { label: head.status, tone: 'neutral' as const }
  const puedeContrato = exigir(ctx, 'employees', 'employees.contract.create').ok && head.status !== 'terminated'
  const puedeDarDeBaja = exigir(ctx, 'employees', 'employees.employee.terminate').ok && head.status !== 'terminated'
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="employeeId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/empleados">
      <div className="space-y-5">
        <PageHeader
          icon="badge"
          title={`${head.first_name} ${head.last_name}`}
          description={`${head.code} · ${head.position}${head.department ? ` · ${head.department}` : ''}`}
          crumbs={[
            { label: 'Empleados', href: `/empleados${qs}` },
            { label: `${head.first_name} ${head.last_name}` },
          ]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={e.tone}>{e.label}</Badge>
              {head.manager_name && (
                <span className="text-xs text-[var(--color-text-muted)]">Reporta a {head.manager_name}</span>
              )}
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Salario actual" value={`RD$ ${money(Number(head.salary))}`} />
          <StatCard label="Ingreso" value={fecha(head.hire_date)} hint={`${anos} ano${anos === 1 ? '' : 's'}`} />
          <StatCard label="Cedula" value={head.national_id ?? '—'} />
          <StatCard label="Contacto" value={head.email ?? head.phone ?? '—'} />
        </section>

        {head.status === 'terminated' && (
          <Card>
            <CardBody className="text-sm text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">Dado de baja</strong>{' '}
              {head.termination_date && `el ${fecha(head.termination_date)}`} — {head.termination_reason}
            </CardBody>
          </Card>
        )}

        {(puedeContrato || puedeDarDeBaja) && (
          <div className="grid gap-3 md:grid-cols-2">
            {puedeContrato && (
              <Card>
                <CardHeader>
                  <CardTitle>Registrar contrato (promocion o cambio de salario)</CardTitle>
                </CardHeader>
                <CardBody>
                  <form action={crearContratoForm} className="space-y-2">
                    {campos}
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Tipo
                      <select name="contractType" defaultValue="indefinido" className={claseInput}>
                        {Object.entries(TIPO_CONTRATO).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Nuevo cargo
                      <input name="position" required defaultValue={head.position} className={claseInput} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Nuevo salario
                      <input
                        name="salary"
                        required
                        defaultValue={head.salary}
                        inputMode="decimal"
                        className={`tabular text-right ${claseInput}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Desde
                      <input name="startDate" type="date" className={claseInput} />
                    </label>
                    <BotonEnvio
                      
                      className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="trending_up" size={18} />
                      Registrar contrato
                    </BotonEnvio>
                  </form>
                </CardBody>
              </Card>
            )}

            {puedeDarDeBaja && (
              <Card>
                <CardHeader>
                  <CardTitle>Dar de baja</CardTitle>
                </CardHeader>
                <CardBody>
                  <form action={darDeBajaEmpleadoForm} className="space-y-2">
                    {campos}
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Fecha
                      <input name="terminationDate" type="date" className={claseInput} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Motivo
                      <input name="reason" required minLength={4} placeholder="Renuncia voluntaria" className={claseInput} />
                    </label>
                    <BotonEnvio
                      
                      className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="person_remove" size={18} />
                      Dar de baja
                    </BotonEnvio>
                  </form>
                </CardBody>
              </Card>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Historial de contratos</CardTitle>
          </CardHeader>
          <CardBody>
            <Table>
              <THead>
                <TR>
                  <TH>Desde</TH>
                  <TH>Tipo</TH>
                  <TH>Cargo</TH>
                  <TH numeric>Salario</TH>
                  <TH>Vigente</TH>
                </TR>
              </THead>
              <TBody>
                {contratos.map((c) => (
                  <TR key={c.id} className={c.is_active ? '' : 'opacity-60'}>
                    <TD>{fecha(c.start_date)}</TD>
                    <TD>{TIPO_CONTRATO[c.contract_type] ?? c.contract_type}</TD>
                    <TD>{c.position}</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(c.salary))}</span>
                    </TD>
                    <TD>{c.is_active ? <Badge tone="success">Vigente</Badge> : <Badge tone="neutral">Historico</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
