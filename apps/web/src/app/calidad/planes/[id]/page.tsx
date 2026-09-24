import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import { agregarCriterioForm, alternarPlanActivoForm, quitarCriterioForm } from '../../actions'
import { ALCANCE_PLAN } from '../../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface PlanHead {
  id: string
  name: string
  scope: string
  product_name: string | null
  active: boolean
}

interface CriterioRow {
  id: string
  criterion: string
  is_critical: boolean
}

/** Detalle de un plan de inspeccion (modulo 58): sus criterios y si esta activo. */
export default async function PlanDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'quality', 'quality.manage')

  const { head, criterios } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<PlanHead[]>`
      select ip.id, ip.name, ip.scope, pr.name as product_name, ip.active
      from public.inspection_plans ip
      left join public.products pr on pr.id = ip.product_id
      where ip.id = ${id} and ip.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, criterios: [] }

    const c = await tx<CriterioRow[]>`
      select id, criterion, is_critical from public.inspection_plan_criteria
      where plan_id = ${id} and tenant_id = ${ctx.tenantId}
      order by sort_order, criterion`

    return { head: h, criterios: c }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'quality', 'quality.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="planId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/calidad">
      <div className="space-y-5">
        <PageHeader
          icon="checklist"
          title={head.name}
          crumbs={[
            { label: 'Control de calidad', href: `/calidad${qs}` },
            { label: 'Planes', href: `/calidad/planes${qs}` },
            { label: head.name },
          ]}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={head.active ? 'success' : 'neutral'}>
                {head.active ? 'Activo' : 'Inactivo'}
              </Badge>
              {puedeGestionar && (
                <form action={alternarPlanActivoForm}>
                  {campos}
                  <input type="hidden" name="activo" value={String(head.active)} />
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                    {head.active ? 'Desactivar' : 'Activar'}
                  </BotonEnvio>
                </form>
              )}
            </div>
          }
        />

        <p className="text-xs text-[var(--color-text-muted)]">
          {ALCANCE_PLAN[head.scope] ?? head.scope} ·{' '}
          {head.product_name ?? 'General -cualquier producto-'}
        </p>

        {criterios.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Este plan todavía no tiene criterios.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Criterio</TH>
                <TH>Tipo</TH>
                {puedeGestionar && (
                  <TH>
                    <span className="sr-only">Acción</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {criterios.map((c) => (
                <TR key={c.id}>
                  <TD className="text-[var(--color-text-primary)]">{c.criterion}</TD>
                  <TD>
                    <Badge tone={c.is_critical ? 'danger' : 'neutral'}>
                      {c.is_critical ? 'Critico' : 'Menor'}
                    </Badge>
                  </TD>
                  {puedeGestionar && (
                    <TD>
                      <form action={quitarCriterioForm}>
                        {campos}
                        <input type="hidden" name="criterionId" value={c.id} />
                        <BotonEnvio
                          aria-label={`Quitar criterio ${c.criterion}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]"
                        >
                          <Icon name="delete" size={16} />
                        </BotonEnvio>
                      </form>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Agregar criterio</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={agregarCriterioForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Criterio
                  <input
                    name="criterion"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                  <input type="checkbox" name="isCritical" />
                  Critico -reprueba la inspección entera si falla-
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Agregar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
