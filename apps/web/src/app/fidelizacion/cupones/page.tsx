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
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { cuponVigente } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearCuponForm, transicionarCuponForm } from '../actions'
import { ESTADO_CUPON } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cupones · REGB ERP' }

interface CuponFila {
  id: string
  code: string
  customer_name: string | null
  discount_type: string
  discount_value: string
  status: string
  expires_at: string | null
}

interface ClienteOption {
  id: string
  name: string
}

const badgeEstado = (s: string): 'success' | 'danger' | 'neutral' => {
  if (s === 'active') return 'success'
  if (s === 'expired') return 'danger'
  return 'neutral'
}

/** Cupones de fidelizacion (modulo 38): activo hasta redimirse o expirar, ambos terminales. */
export default async function CuponesPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'loyalty')

  const { cupones, clientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<CuponFila[]>`
      select lc.id, lc.code, cu.name as customer_name, lc.discount_type, lc.discount_value::text, lc.status, lc.expires_at::text
      from public.loyalty_coupons lc
      left join public.customers cu on cu.id = lc.customer_id
      where lc.tenant_id = ${ctx.tenantId}
      order by lc.created_at desc`
    const cl = await tx<ClienteOption[]>`
      select id, name from public.customers where tenant_id = ${ctx.tenantId} order by name limit 300`
    return { cupones: c, clientes: cl }
  })

  const puedeGestionar = exigir(ctx, 'loyalty', 'loyalty.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/fidelizacion">
      <div className="space-y-5">
        <PageHeader
          icon="confirmation_number"
          title="Cupones"
          crumbs={[{ label: 'Fidelizacion', href: `/fidelizacion${qs}` }, { label: 'Cupones' }]}
        />

        {cupones.length === 0 ? (
          <EmptyState
            icon="confirmation_number"
            title="Todavia no hay ningun cupon"
            description="Crea el primero abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Código</TH>
                <TH>Cliente</TH>
                <TH numeric>Descuento</TH>
                <TH>Vence</TH>
                <TH>Estado</TH>
                <TH>
                  <span className="sr-only">Acción</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {cupones.map((c) => {
                const vencido =
                  c.status === 'active' &&
                  !cuponVigente(c.expires_at ? new Date(c.expires_at) : null, new Date())
                return (
                  <TR key={c.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <Mono>{c.code}</Mono>
                    </TD>
                    <TD className="text-[var(--color-text-muted)]">
                      {c.customer_name ?? 'Cualquier cliente'}
                    </TD>
                    <TD numeric>
                      <span className="tabular">
                        {c.discount_type === 'percentage'
                          ? `${(Number(c.discount_value) * 100).toFixed(0)}%`
                          : `RD$ ${Number(c.discount_value).toLocaleString('es-DO', { minimumFractionDigits: 2 })}`}
                      </span>
                    </TD>
                    <TD className="text-[var(--color-text-muted)]">
                      {c.expires_at
                        ? new Date(c.expires_at).toLocaleDateString('es-DO')
                        : 'Sin vencimiento'}
                    </TD>
                    <TD>
                      <Badge tone={badgeEstado(vencido ? 'expired' : c.status)}>
                        {vencido ? 'Vencido' : (ESTADO_CUPON[c.status] ?? c.status)}
                      </Badge>
                    </TD>
                    <TD>
                      {puedeGestionar && c.status === 'active' && (
                        <div className="flex gap-2">
                          <form action={transicionarCuponForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="couponId" value={c.id} />
                            <input type="hidden" name="siguiente" value="redeemed" />
                            <BotonEnvio className="flex h-7 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                              Redimir
                            </BotonEnvio>
                          </form>
                        </div>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo cupon</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCuponForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Codigo
                  <input
                    name="code"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente (opcional)
                  <select
                    name="customerId"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Cualquier cliente</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select
                    name="discountType"
                    defaultValue="percentage"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="percentage">Porcentaje</option>
                    <option value="fixed">Monto fijo (RD$)</option>
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Valor
                  <input
                    name="discountValue"
                    required
                    inputMode="decimal"
                    placeholder="10"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vence (opcional)
                  <input
                    type="date"
                    name="expiresAt"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
