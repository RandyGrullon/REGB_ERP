import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  Mono,
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
import { crearEntradaForm, transicionarEntradaForm } from './actions'
import { ESTADO_COMISION } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comisiones · REGB ERP' }

interface EntradaRow {
  id: string
  order_number: string
  salesperson_name: string | null
  base_amount: string
  commission_amount: string
  status: string
}

interface PlanOption {
  id: string
  name: string
}

interface OrdenOption {
  id: string
  number: string
  total: string
}

interface VendedorOption {
  id: string
  name: string
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'paid') return 'success'
  if (s === 'rejected') return 'danger'
  if (s === 'pending') return 'warning'
  return 'neutral'
}
const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'
const botonClase =
  'flex h-8 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'

/** Comisiones (modulo 34): una sola formula por plan, liquidacion con aprobacion real. */
export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'commissions')

  const { entradas, planes, ordenes, vendedores } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const e = await tx<EntradaRow[]>`
      select ce.id, so.number as order_number, up.display_name as salesperson_name,
             ce.base_amount::text, ce.commission_amount::text, ce.status
      from public.commission_entries ce
      join public.sales_orders so on so.id = ce.sales_order_id
      left join public.user_profiles up on up.user_id = ce.salesperson_id and up.tenant_id = ce.tenant_id
      where ce.tenant_id = ${ctx.tenantId}
      order by ce.created_at desc`
    const p = await tx<PlanOption[]>`
      select id, name from public.commission_plans where tenant_id = ${ctx.tenantId} and active order by name`
    const o = await tx<OrdenOption[]>`
      select id, number, total::text from public.sales_orders
      where tenant_id = ${ctx.tenantId} order by order_date desc limit 100`
    const v = await tx<VendedorOption[]>`
      select user_id as id, display_name as name from public.user_profiles
      where tenant_id = ${ctx.tenantId} order by display_name`
    return { entradas: e, planes: p, ordenes: o, vendedores: v }
  })

  const pendientes = entradas.filter((e) => e.status === 'pending').length
  const puedeGestionar = exigir(ctx, 'commissions', 'commissions.manage').ok
  const qs = ctx.demoQs
  const campos = (id: string) => (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="entryId" value={id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/comisiones">
      <div className="space-y-5">
        <PageHeader
          icon="percent"
          title="Comisiones"
          description="Una sola formula por plan -porcentaje o monto fijo-. No se paga sin aprobar primero."
          actions={
            <a
              href={`/comisiones/planes${qs}`}
              className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
            >
              Planes de comision
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Entradas" value={String(entradas.length)} />
          <StatCard label="Pendientes de aprobar" value={String(pendientes)} />
        </section>

        {entradas.length === 0 ? (
          <EmptyState icon="percent" title="Todavia no hay ninguna comision" description="" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Orden</TH>
                <TH>Vendedor</TH>
                <TH numeric>Base</TH>
                <TH numeric>Comision</TH>
                <TH>Estado</TH>
                {puedeGestionar && (
                  <TH>
                    <span className="sr-only">Accion</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {entradas.map((e) => (
                <TR key={e.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <Mono>{e.order_number}</Mono>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">{e.salesperson_name ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(e.base_amount))}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular font-semibold">RD$ {money(Number(e.commission_amount))}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(e.status)}>{ESTADO_COMISION[e.status] ?? e.status}</Badge>
                  </TD>
                  {puedeGestionar && (
                    <TD>
                      {e.status === 'pending' && (
                        <div className="flex gap-1.5">
                          <form action={transicionarEntradaForm}>
                            {campos(e.id)}
                            <input type="hidden" name="siguiente" value="approved" />
                            <BotonEnvio  className={botonClase}>
                              <Icon name="check_circle" size={13} />
                              Aprobar
                            </BotonEnvio>
                          </form>
                          <form action={transicionarEntradaForm}>
                            {campos(e.id)}
                            <input type="hidden" name="siguiente" value="rejected" />
                            <BotonEnvio
                              
                              className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]"
                              aria-label="Rechazar comision">
                              <Icon name="close" size={16} />
                            </BotonEnvio>
                          </form>
                        </div>
                      )}
                      {e.status === 'approved' && (
                        <form action={transicionarEntradaForm}>
                          {campos(e.id)}
                          <input type="hidden" name="siguiente" value="paid" />
                          <BotonEnvio  className={botonClase}>
                            <Icon name="payments" size={13} />
                            Pagar
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

        {puedeGestionar && planes.length > 0 && ordenes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva comision</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearEntradaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Plan
                  <select name="planId" required className={claseInput}>
                    {planes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Orden de venta
                  <select name="salesOrderId" required className={claseInput}>
                    {ordenes.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number} — RD$ {money(Number(o.total))}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vendedor
                  <select name="salespersonId" required className={claseInput}>
                    {vendedores.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
