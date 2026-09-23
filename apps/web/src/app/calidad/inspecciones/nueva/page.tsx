import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { registrarInspeccionForm } from '../../actions'
import { ALCANCE_PLAN } from '../../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nueva inspeccion · REGB ERP' }

interface PlanOption {
  id: string
  name: string
  scope: string
  product_id: string | null
  product_name: string | null
}

interface CriterioRow {
  id: string
  criterion: string
  is_critical: boolean
}

interface ProductoOption {
  id: string
  sku: string
  name: string
}

/** Registrar una inspeccion real (modulo 58): elige el plan, marca pasa/falla por criterio. */
export default async function NuevaInspeccionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { planId?: string }>
}) {
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'quality', 'quality.inspect')

  const { planes, planElegido, criterios, productos } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const pl = await tx<PlanOption[]>`
        select ip.id, ip.name, ip.scope, ip.product_id, pr.name as product_name
        from public.inspection_plans ip
        left join public.products pr on pr.id = ip.product_id
        where ip.tenant_id = ${ctx.tenantId} and ip.active
        order by ip.name`

      const elegido = sp.planId ? pl.find((p) => p.id === sp.planId) ?? null : null
      const crit = elegido
        ? await tx<CriterioRow[]>`
            select id, criterion, is_critical from public.inspection_plan_criteria
            where plan_id = ${elegido.id} and tenant_id = ${ctx.tenantId}
            order by sort_order, criterion`
        : []
      const prods =
        elegido && !elegido.product_id
          ? await tx<ProductoOption[]>`
              select id, sku, name from public.products
              where tenant_id = ${ctx.tenantId} and active order by name limit 300`
          : []

      return { planes: pl, planElegido: elegido, criterios: crit, productos: prods }
    },
  )

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/calidad">
      <div className="space-y-5">
        <PageHeader
          icon="fact_check"
          title="Nueva inspeccion"
          crumbs={[{ label: 'Control de calidad', href: `/calidad${qs}` }, { label: 'Nueva inspeccion' }]}
        />

        <Card>
          <CardHeader>
            <CardTitle>Elige el plan</CardTitle>
          </CardHeader>
          <CardBody>
            {planes.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                No hay ningun plan de inspeccion activo -crea uno primero en Planes de inspeccion-.
              </p>
            ) : (
              <form method="get" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Plan de inspeccion
                  <select
                    name="planId"
                    defaultValue={planElegido?.id ?? ''}
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Elige uno…</option>
                    {planes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({ALCANCE_PLAN[p.scope] ?? p.scope}
                        {p.product_name ? ` · ${p.product_name}` : ''})
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                  Cargar criterios
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        {planElegido && (
          <Card>
            <CardHeader>
              <CardTitle>{planElegido.name}</CardTitle>
            </CardHeader>
            <CardBody>
              {criterios.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Este plan no tiene criterios todavia.
                </p>
              ) : (
                <form action={registrarInspeccionForm} className="space-y-4">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="planId" value={planElegido.id} />

                  {planElegido.product_id ? (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Producto: <strong>{planElegido.product_name}</strong>
                      <input type="hidden" name="productId" value={planElegido.product_id} />
                    </p>
                  ) : (
                    <label className="flex max-w-sm flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Producto (opcional)
                      <select
                        name="productId"
                        className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                      >
                        <option value="">Sin producto especifico</option>
                        {productos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} — {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className="space-y-2">
                    {criterios.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2"
                      >
                        <span className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                          {c.criterion}
                          {c.is_critical && <Badge tone="danger">Critico</Badge>}
                        </span>
                        <fieldset className="flex gap-3 text-xs">
                          <legend className="sr-only">Resultado de {c.criterion}</legend>
                          <label className="flex items-center gap-1">
                            <input
                              type="radio"
                              name={`criterio_${c.id}`}
                              value="pass"
                              defaultChecked
                              required
                            />
                            Aprueba
                          </label>
                          <label className="flex items-center gap-1">
                            <input type="radio" name={`criterio_${c.id}`} value="fail" />
                            Reprueba
                          </label>
                        </fieldset>
                      </div>
                    ))}
                  </div>

                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Notas (opcional)
                    <textarea
                      name="notes"
                      rows={2}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>

                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="check_circle" size={14} />
                    Registrar inspeccion
                  </BotonEnvio>
                </form>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
