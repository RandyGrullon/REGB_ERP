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
import { yearsOfService } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearEmpleadoForm } from './actions'
import { ESTADO_EMPLEADO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Empleados · REGB ERP' }

interface EmpleadoRow {
  id: string
  code: string
  first_name: string
  last_name: string
  position: string
  department: string | null
  hire_date: string
  salary: string
  status: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Empleados (modulo 61): expediente, contratos y organigrama. */
export default async function EmpleadosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'employees')

  const [empleados] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const e = await tx<EmpleadoRow[]>`
      select id, code, first_name, last_name, position, department,
             hire_date::text, salary::text, status
      from public.employees
      where tenant_id = ${ctx.tenantId}
      order by status, last_name, first_name
      limit 200`
    return [e] as const
  })

  const activos = empleados.filter((e) => e.status === 'active')
  const nominaTotal = activos.reduce((a, e) => a + Number(e.salary), 0)
  const puedeCrear = exigir(ctx, 'employees', 'employees.employee.create').ok
  const qs = ctx.demoQs
  const hoy = new Date()
  // El siguiente codigo libre (E-003 → E-004), para no tener que ir a
  // mirar la lista antes de dar de alta a alguien.
  const siguienteCodigo = (() => {
    let prefijo = 'E-'
    let mayor = 0
    let ancho = 3
    for (const e of empleados) {
      const m = /^(.*?)(\d+)$/.exec(e.code)
      if (m && Number(m[2]) >= mayor) {
        prefijo = m[1]!
        mayor = Number(m[2])
        ancho = m[2]!.length
      }
    }
    return `${prefijo}${String(mayor + 1).padStart(ancho, '0')}`
  })()

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/empleados">
      <div className="space-y-5">
        <PageHeader
          icon="badge"
          title="Empleados"
          description="Expediente, contratos y a quién le reporta cada quien."
          actions={
            <a
              href={`/empleados/organigrama${qs}`}
              className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="account_tree" size={18} />
              Ver organigrama
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Empleados activos" value={String(activos.length)} />
          <StatCard
            label="Nómina mensual"
            value={`RD$ ${money(nominaTotal)}`}
            hint="salarios activos"
          />
          <StatCard
            label="Dados de baja"
            value={String(empleados.filter((e) => e.status === 'terminated').length)}
          />
        </section>

        {empleados.length === 0 ? (
          <EmptyState
            icon="badge"
            title="Todavía no hay ningún empleado registrado"
            description="El expediente de cada persona: cargo, salario, contrato y a quién le reporta. Con él se calcula la nómina y el saldo de vacaciones. Registra el primero abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH className="hidden sm:table-cell">Cargo</TH>
                <TH className="hidden md:table-cell">Departamento</TH>
                <TH className="hidden sm:table-cell">Ingreso</TH>
                <TH numeric>Antigüedad</TH>
                <TH numeric>Salario</TH>
                <TH className="hidden sm:table-cell">Estado</TH>
              </TR>
            </THead>
            <TBody>
              {empleados.map((e) => {
                const es = ESTADO_EMPLEADO[e.status] ?? {
                  label: e.status,
                  tone: 'neutral' as const,
                }
                const anos = yearsOfService(new Date(`${e.hire_date.slice(0, 10)}T12:00:00`), hoy)
                return (
                  <TR key={e.id} className={e.status === 'terminated' ? 'opacity-50' : ''}>
                    <TD>
                      <a
                        href={`/empleados/${e.id}${qs}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {e.first_name} {e.last_name}
                      </a>
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {e.code}
                        {/* En el teléfono el cargo va aquí: la columna se esconde. */}
                        <span className="sm:hidden">
                          {' · '}
                          {e.position}
                          {e.status !== 'active' ? ` · ${es.label}` : ''}
                        </span>
                      </span>
                    </TD>
                    <TD className="hidden sm:table-cell">{e.position}</TD>
                    <TD className="hidden md:table-cell">{e.department ?? '—'}</TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{fecha(e.hire_date)}</TD>
                    <TD numeric>
                      <span className="tabular whitespace-nowrap">
                        {anos === 0 ? 'Menos de 1 año' : `${anos} año${anos === 1 ? '' : 's'}`}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(e.salary))}</span>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Badge tone={es.tone}>{es.label}</Badge>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar empleado</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearEmpleadoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Código
                  <input
                    name="code"
                    required
                    defaultValue={siguienteCodigo}
                    className={claseInput}
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="firstName" required placeholder="Juana" className={claseInput} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Apellido
                  <input name="lastName" required placeholder="Pérez" className={claseInput} />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cargo
                  <input name="position" required placeholder="Cajera" className={claseInput} />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Departamento
                  <input name="department" placeholder="Ventas" className={claseInput} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cédula
                  <input
                    name="nationalId"
                    inputMode="numeric"
                    placeholder="001-1234567-8"
                    className={claseInput}
                  />
                </label>
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Correo (opcional)
                  <input name="email" type="email" autoComplete="off" className={claseInput} />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Teléfono (opcional)
                  <input
                    name="phone"
                    type="tel"
                    placeholder="809-555-0101"
                    className={claseInput}
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha de ingreso
                  <input name="hireDate" type="date" required className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Salario mensual (RD$)
                  <input
                    name="salary"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Jefe (opcional)
                  <select name="managerId" defaultValue="" className={claseInput}>
                    <option value="">Sin jefe directo</option>
                    {activos.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.first_name} {e.last_name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="person_add" size={18} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
