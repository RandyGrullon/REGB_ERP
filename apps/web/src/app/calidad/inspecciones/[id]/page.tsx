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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { abrirNoConformidadForm } from '../../actions'
import { RESULTADO_INSPECCION } from '../../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface InspeccionHead {
  id: string
  plan_name: string
  product_name: string | null
  result: string
  performed_at: string
  notes: string | null
}

interface ResultadoRow {
  id: string
  criterion: string
  is_critical: boolean
  passed: boolean
}

interface NcRow {
  id: string
  description: string
  status: string
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
const badgeResultado = (r: string): 'success' | 'danger' | 'warning' => {
  if (r === 'passed') return 'success'
  if (r === 'failed') return 'danger'
  return 'warning'
}

/** Detalle de una inspeccion (modulo 58): resultado por criterio, y abrir una no conformidad si hizo falta. */
export default async function InspeccionDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'quality')

  const { head, resultados, noConformidades } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<InspeccionHead[]>`
      select insp.id, ip.name as plan_name, pr.name as product_name, insp.result,
             insp.performed_at::text, insp.notes
      from public.inspections insp
      join public.inspection_plans ip on ip.id = insp.plan_id
      left join public.products pr on pr.id = insp.product_id
      where insp.id = ${id} and insp.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, resultados: [], noConformidades: [] }

    const r = await tx<ResultadoRow[]>`
      select id, criterion, is_critical, passed from public.inspection_results
      where inspection_id = ${id} and tenant_id = ${ctx.tenantId}
      order by criterion`

    const nc = await tx<NcRow[]>`
      select id, description, status from public.non_conformances
      where inspection_id = ${id} and tenant_id = ${ctx.tenantId}
      order by detected_at desc`

    return { head: h, resultados: r, noConformidades: nc }
  })

  if (!head) notFound()

  const puedeInspeccionar = exigir(ctx, 'quality', 'quality.inspect').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/calidad">
      <div className="space-y-5">
        <PageHeader
          icon="fact_check"
          title={head.plan_name}
          crumbs={[{ label: 'Control de calidad', href: `/calidad${qs}` }, { label: 'Inspeccion' }]}
          actions={<Badge tone={badgeResultado(head.result)}>{RESULTADO_INSPECCION[head.result] ?? head.result}</Badge>}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Producto" value={head.product_name ?? '—'} />
          <StatCard label="Fecha" value={fecha(head.performed_at)} />
        </section>

        {head.notes && (
          <p className="text-xs text-[var(--color-text-muted)]">
            <Icon name="sticky_note_2" size={12} /> {head.notes}
          </p>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Criterio</TH>
              <TH>Tipo</TH>
              <TH>Resultado</TH>
            </TR>
          </THead>
          <TBody>
            {resultados.map((r) => (
              <TR key={r.id}>
                <TD className="text-[var(--color-text-primary)]">{r.criterion}</TD>
                <TD>
                  <Badge tone={r.is_critical ? 'danger' : 'neutral'}>{r.is_critical ? 'Critico' : 'Menor'}</Badge>
                </TD>
                <TD>
                  <Badge tone={r.passed ? 'success' : 'danger'}>{r.passed ? 'Aprueba' : 'Reprueba'}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        {noConformidades.length > 0 && (
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">No conformidades abiertas de aqui</h2>
            {noConformidades.map((nc) => (
              <p key={nc.id} className="text-xs">
                <a href={`/calidad/no-conformidades/${nc.id}${qs}`} className="text-[var(--color-text-link)] underline-offset-2 hover:underline">
                  {nc.description}
                </a>
              </p>
            ))}
          </div>
        )}

        {head.result !== 'passed' && puedeInspeccionar && (
          <Card>
            <CardHeader>
              <CardTitle>Abrir no conformidad</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={abrirNoConformidadForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <input type="hidden" name="inspectionId" value={head.id} />
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input
                    name="description"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Severidad
                  <select
                    name="severity"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="minor">Menor</option>
                    <option value="major">Mayor</option>
                    <option value="critical">Critica</option>
                  </select>
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="report" size={14} />
                  Abrir
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
