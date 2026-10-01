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
  po_id: string | null
  created_at: string
  approved_at: string | null
  decision_note: string | null
  aprobado_por: string | null
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
             pr.estimated_amount::text, pr.status, pr.po_reference,
             (select po.id from public.purchase_orders po
               where po.tenant_id = pr.tenant_id and po.number = pr.po_reference) as po_id,
             pr.created_at::text, pr.approved_at::text, pr.decision_note,
             up.display_name as aprobado_por
      from public.purchase_requisitions pr
      join public.employees e on e.id = pr.employee_id
      left join public.user_profiles up
        on up.tenant_id = pr.tenant_id and up.user_id = pr.approved_by
      where pr.tenant_id = ${ctx.tenantId}
      order by pr.created_at desc`

    return { empleados: e, requisiciones: r }
  })

  const pendientes = requisiciones.filter((r) => r.status === 'pending').length
  const porComprar = requisiciones.filter((r) => r.status === 'approved').length
  const montoPendiente = requisiciones
    .filter((r) => r.status === 'pending')
    .reduce((a, r) => a + Number(r.estimated_amount), 0)
  const puedeVerCompras = exigir(ctx, 'purchase-orders', 'purchase-orders.view').ok
  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
  const puedeSolicitar = exigir(ctx, 'requisitions', 'requisitions.request').ok
  const puedeAprobar = exigir(ctx, 'requisitions', 'requisitions.approve').ok
  // Marcar convertida la hace quien aprueba o quien hace la orden de compra
  // (el comprador): "lo aprobado pasa a Compras para convertirlo en orden".
  const puedeConvertir = puedeAprobar || exigir(ctx, 'purchase-orders', 'purchase-orders.create').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/requisiciones">
      <div className="space-y-5">
        <PageHeader
          icon="assignment"
          title="Requisiciones"
          description="Lo que un empleado necesita que se compre. Quien aprueba lo hace hasta el límite de monto de su rol; lo aprobado pasa a Compras para convertirlo en orden."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Pendientes de aprobar"
            value={String(pendientes)}
            hint={`RD$ ${money(montoPendiente)} en total`}
          />
          <StatCard
            label="Aprobadas por comprar"
            value={String(porComprar)}
            hint="sin orden todavía"
          />
          <StatCard label="Requisiciones" value={String(requisiciones.length)} hint="todas" />
        </section>

        {requisiciones.length === 0 ? (
          <EmptyState
            icon="assignment"
            title="Todavía no hay ninguna requisición"
            description="Cuando alguien del equipo necesite algo (papelería, repuestos, mercancía), se registra abajo con su monto estimado y queda esperando aprobación."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Pedida</TH>
                <TH>Empleado</TH>
                <TH>Qué se necesita</TH>
                <TH numeric>Monto estimado</TH>
                <TH>Estado</TH>
                {puedeConvertir && (
                  <TH>
                    <span className="sr-only">Acción</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {requisiciones.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap">{fecha(r.created_at)}</TD>
                  <TD className="text-[var(--color-text-primary)]">
                    {r.employee_name}
                    {r.department && (
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {r.department}
                      </span>
                    )}
                  </TD>
                  <TD className="max-w-72">
                    <span className="line-clamp-2" title={r.description}>
                      {r.description}
                    </span>
                    {r.decision_note && (
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {r.decision_note}
                      </span>
                    )}
                  </TD>
                  <TD numeric>
                    <span className="tabular whitespace-nowrap">
                      RD$ {money(Number(r.estimated_amount))}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={badgeTono(r.status)}>
                      {ESTADO_REQUISICION[r.status] ?? r.status}
                    </Badge>
                    {r.po_reference &&
                      (r.po_id && puedeVerCompras ? (
                        <a
                          href={`/compras/${r.po_id}${qs}`}
                          className="block pt-1 text-xs whitespace-nowrap text-[var(--color-text-link)] hover:underline"
                        >
                          {r.po_reference}
                        </a>
                      ) : (
                        <span className="block pt-1 text-xs whitespace-nowrap text-[var(--color-text-muted)]">
                          {r.po_reference}
                        </span>
                      ))}
                    {r.approved_at && r.status !== 'pending' && (
                      <span className="block text-xs whitespace-nowrap text-[var(--color-text-muted)]">
                        {r.aprobado_por ? `${r.aprobado_por}, ` : ''}
                        {fecha(r.approved_at)}
                      </span>
                    )}
                  </TD>
                  {puedeConvertir && (
                    <TD>
                      {r.status === 'pending' && puedeAprobar && (
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
                            placeholder="Número de la orden"
                            className={claseInput}
                          />
                          <BotonEnvio className="flex h-9 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
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
              <CardTitle>Nueva requisición</CardTitle>
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
                  Qué se necesita
                  <input
                    name="description"
                    required
                    placeholder="Resmas de papel y tóner para la oficina"
                    className={claseInput}
                  />
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
