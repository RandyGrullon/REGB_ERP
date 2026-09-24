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
import { crearRequisicionForm, marcarConvertidaForm, resolverRequisicionForm } from './actions'
import { ESTADO_REQUISICION } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Requisiciones · REGB ERP' }

interface EmpleadoOption {
  id: string
  name: string
}

interface RequisicionRow {
  id: string
  employee_name: string
  department: string | null
  description: string
  estimated_amount: string
  status: string
  po_reference: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'approved' || estado === 'converted') return 'success'
  if (estado === 'pending') return 'warning'
  if (estado === 'rejected') return 'danger'
  return 'neutral'
}

/** Requisiciones (modulo 43): aprobacion por monto -el limite de cada rol decide-. */
export default async function RequisicionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'requisitions')

  const { empleados, requisiciones } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const e = await tx<EmpleadoOption[]>`
      select id, first_name || ' ' || last_name as name from public.employees
      where tenant_id = ${ctx.tenantId} and status = 'active' order by last_name`

    const r = await tx<RequisicionRow[]>`
      select pr.id, e.first_name || ' ' || e.last_name as employee_name, pr.department, pr.description,
             pr.estimated_amount::text, pr.status, pr.po_reference
      from public.purchase_requisitions pr
      join public.employees e on e.id = pr.employee_id
      where pr.tenant_id = ${ctx.tenantId}
      order by pr.created_at desc`

    return { empleados: e, requisiciones: r }
  })

  const pendientes = requisiciones.filter((r) => r.status === 'pending').length
  const puedeSolicitar = exigir(ctx, 'requisitions', 'requisitions.request').ok
  const puedeAprobar = exigir(ctx, 'requisitions', 'requisitions.approve').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/requisiciones">
      <div className="space-y-5">
        <PageHeader
          icon="assignment"
          title="Requisiciones"
          description="Aprobar usa el mismo limite de monto que ya tiene cada rol -si no alcanza, el sistema lo dice claro-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Pendientes de aprobar" value={String(pendientes)} />
          <StatCard label="Requisiciones totales" value={String(requisiciones.length)} />
        </section>

        {requisiciones.length === 0 ? (
          <EmptyState
            icon="assignment"
            title="Todavia no hay ninguna requisicion"
            description="Registra la primera abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH>Que se necesita</TH>
                <TH numeric>Monto estimado</TH>
                <TH>Estado</TH>
                {puedeAprobar && (
                  <TH>
                    <span className="sr-only">Acción</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {requisiciones.map((r) => (
                <TR key={r.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    {r.employee_name}
                    {r.department ? ` · ${r.department}` : ''}
                  </TD>
                  <TD className="max-w-64 truncate">{r.description}</TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(r.estimated_amount))}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeTono(r.status)}>
                      {ESTADO_REQUISICION[r.status] ?? r.status}
                    </Badge>
                    {r.po_reference ? (
                      <span className="ml-1 text-xs text-[var(--color-text-muted)]">
                        {r.po_reference}
                      </span>
                    ) : null}
                  </TD>
                  {puedeAprobar && (
                    <TD>
                      {r.status === 'pending' && (
                        <div className="flex gap-1.5">
                          <form action={resolverRequisicionForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="requisitionId" value={r.id} />
                            <input type="hidden" name="decision" value="approved" />
                            <BotonEnvio className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-semantic-success)] px-2 text-xs font-medium text-white hover:opacity-90">
                              <Icon name="check" size={14} />
                              Aprobar
                            </BotonEnvio>
                          </form>
                          <form action={resolverRequisicionForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="requisitionId" value={r.id} />
                            <input type="hidden" name="decision" value="rejected" />
                            <BotonEnvio className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                              <Icon name="close" size={14} />
                              Rechazar
                            </BotonEnvio>
                          </form>
                        </div>
                      )}
                      {r.status === 'approved' && (
                        <form action={marcarConvertidaForm} className="flex items-center gap-1.5">
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="requisitionId" value={r.id} />
                          <input
                            name="poReference"
                            aria-label={`Referencia de orden para ${r.description}`}
                            placeholder="OC-2026-00001"
                            className={claseInput}
                          />
                          <BotonEnvio className="flex h-9 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                            Marcar convertida
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

        {puedeSolicitar && empleados.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva requisicion</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearRequisicionForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
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
                  Departamento
                  <input name="department" className={claseInput} />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Que se necesita
                  <input name="description" required className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto estimado
                  <input
                    name="estimatedAmount"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="send" size={14} />
                  Enviar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
