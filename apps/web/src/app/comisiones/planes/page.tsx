import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
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
import { crearPlanForm } from '../actions'
import { ESQUEMA_COMISION } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Planes de comision · REGB ERP' }

interface PlanRow {
  id: string
  name: string
  basis: string
  rate: string
  active: boolean
}

/** Planes de comision (modulo 34): una sola formula por plan -porcentaje o monto fijo-. */
export default async function PlanesComisionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'commissions', 'commissions.manage')

  const planes = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<PlanRow[]>`
      select id, name, basis, rate::text, active from public.commission_plans
      where tenant_id = ${ctx.tenantId}
      order by name`,
  )

  const puedeGestionar = exigir(ctx, 'commissions', 'commissions.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/comisiones">
      <div className="space-y-5">
        <PageHeader
          icon="percent"
          title="Planes de comision"
          crumbs={[{ label: 'Comisiones', href: `/comisiones${qs}` }, { label: 'Planes' }]}
        />

        {planes.length === 0 ? (
          <EmptyState icon="percent" title="Todavia no hay ningun plan" description="Crea el primero abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Plan</TH>
                <TH>Esquema</TH>
                <TH numeric>Tasa</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {planes.map((p) => (
                <TR key={p.id}>
                  <TD className="text-[var(--color-text-primary)]">{p.name}</TD>
                  <TD>{ESQUEMA_COMISION[p.basis] ?? p.basis}</TD>
                  <TD numeric>
                    <span className="tabular">
                      {p.basis === 'percentage' ? `${(Number(p.rate) * 100).toFixed(1)}%` : `RD$ ${p.rate}`}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Activo' : 'Inactivo'}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo plan</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearPlanForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Esquema
                  <select
                    name="basis"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="percentage">Porcentaje</option>
                    <option value="fixed">Monto fijo</option>
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tasa
                  <input
                    name="rate"
                    required
                    placeholder="0.05 o 250"
                    inputMode="decimal"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
