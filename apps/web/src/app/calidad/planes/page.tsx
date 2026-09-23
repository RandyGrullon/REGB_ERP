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
import { ALCANCE_PLAN } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Planes de inspeccion · REGB ERP' }

interface PlanRow {
  id: string
  name: string
  scope: string
  product_name: string | null
  active: boolean
  criterios: string
}

interface ProductoOption {
  id: string
  sku: string
  name: string
}

/** Planes de inspeccion (modulo 58): plantillas de criterios, por producto o generales. */
export default async function PlanesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'quality', 'quality.manage')

  const { planes, productos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const p = await tx<PlanRow[]>`
      select ip.id, ip.name, ip.scope, pr.name as product_name, ip.active,
             (select count(*) from public.inspection_plan_criteria c where c.plan_id = ip.id)::text as criterios
      from public.inspection_plans ip
      left join public.products pr on pr.id = ip.product_id
      where ip.tenant_id = ${ctx.tenantId}
      order by ip.name`
    const pr = await tx<ProductoOption[]>`
      select id, sku, name from public.products
      where tenant_id = ${ctx.tenantId} and active order by name limit 300`
    return { planes: p, productos: pr }
  })

  const puedeGestionar = exigir(ctx, 'quality', 'quality.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/calidad">
      <div className="space-y-5">
        <PageHeader
          icon="checklist"
          title="Planes de inspeccion"
          description="Que revisar y con que criterios -un criterio marcado como critico reprueba la inspeccion entera si falla-."
          crumbs={[{ label: 'Control de calidad', href: `/calidad${qs}` }, { label: 'Planes' }]}
        />

        {planes.length === 0 ? (
          <EmptyState icon="checklist" title="Todavia no hay ningun plan" description="Crea el primero abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Plan</TH>
                <TH>Alcance</TH>
                <TH>Producto</TH>
                <TH numeric>Criterios</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {planes.map((p) => (
                <TR key={p.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/calidad/planes/${p.id}${qs}`} className="underline-offset-2 hover:underline">
                      {p.name}
                    </a>
                  </TD>
                  <TD>{ALCANCE_PLAN[p.scope] ?? p.scope}</TD>
                  <TD className="text-[var(--color-text-muted)]">{p.product_name ?? 'General'}</TD>
                  <TD numeric>
                    <span className="tabular">{p.criterios}</span>
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
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Alcance
                  <select
                    name="scope"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="receiving">Recepcion</option>
                    <option value="production">En proceso</option>
                    <option value="final">Final</option>
                    <option value="other">Otro</option>
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Producto (opcional)
                  <select
                    name="productId"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">General -cualquier producto-</option>
                    {productos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
