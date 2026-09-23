import {
  Badge,
  EmptyState,
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
import { diasAbierto } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADO_NC, RESULTADO_INSPECCION, SEVERIDAD_NC } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Control de calidad · REGB ERP' }

interface InspeccionRow {
  id: string
  plan_name: string
  product_name: string | null
  result: string
  performed_at: string
}

interface NcRow {
  id: string
  description: string
  severity: string
  status: string
  detected_at: string
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-DO', { dateStyle: 'medium' })

const badgeResultado = (r: string): 'success' | 'danger' | 'warning' => {
  if (r === 'passed') return 'success'
  if (r === 'failed') return 'danger'
  return 'warning'
}

const badgeSeveridad = (s: string): 'neutral' | 'warning' | 'danger' => {
  if (s === 'critical') return 'danger'
  if (s === 'major') return 'warning'
  return 'neutral'
}

/** Control de calidad (modulo 58): inspecciones, no conformidades y CAPA. */
export default async function CalidadPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'quality')

  const { inspecciones, noConformidades, planesActivos, capasAbiertos, tasaAprobacion } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const i = await tx<InspeccionRow[]>`
        select insp.id, ip.name as plan_name, pr.name as product_name, insp.result, insp.performed_at::text
        from public.inspections insp
        join public.inspection_plans ip on ip.id = insp.plan_id
        left join public.products pr on pr.id = insp.product_id
        where insp.tenant_id = ${ctx.tenantId}
        order by insp.performed_at desc
        limit 20`
      const nc = await tx<NcRow[]>`
        select id, description, severity, status, detected_at::text
        from public.non_conformances
        where tenant_id = ${ctx.tenantId} and status not in ('closed', 'dismissed')
        order by detected_at desc`
      const [pa] = await tx<{ n: string }[]>`
        select count(*)::text as n from public.inspection_plans
        where tenant_id = ${ctx.tenantId} and active`
      const [ca] = await tx<{ n: string }[]>`
        select count(*)::text as n from public.capas
        where tenant_id = ${ctx.tenantId} and status != 'closed'`
      const [ta] = await tx<{ pasadas: string; total: string }[]>`
        select count(*) filter (where result != 'failed')::text as pasadas, count(*)::text as total
        from public.inspections where tenant_id = ${ctx.tenantId}`

      return {
        inspecciones: i,
        noConformidades: nc,
        planesActivos: Number(pa?.n ?? 0),
        capasAbiertos: Number(ca?.n ?? 0),
        tasaAprobacion:
          Number(ta?.total ?? 0) > 0 ? (Number(ta!.pasadas) / Number(ta!.total)) * 100 : null,
      }
    },
  )

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/calidad">
      <div className="space-y-5">
        <PageHeader
          icon="verified"
          title="Control de calidad"
          description="Un criterio critico reprobado siempre reprueba la inspeccion entera; uno menor la deja condicional. Una no conformidad no se cierra sin pasar por un CAPA verificado."
          actions={
            <div className="flex items-center gap-2">
              <a
                href={`/calidad/planes${qs}`}
                className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
              >
                Planes de inspeccion
              </a>
              <a
                href={`/calidad/inspecciones/nueva${qs}`}
                className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
              >
                Nueva inspeccion
              </a>
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Planes activos" value={String(planesActivos)} />
          <StatCard
            label="Tasa de aprobacion"
            value={tasaAprobacion === null ? '—' : `${tasaAprobacion.toFixed(0)}%`}
          />
          <StatCard label="No conformidades abiertas" value={String(noConformidades.length)} />
          <StatCard label="CAPA abiertos" value={String(capasAbiertos)} />
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Inspecciones recientes
            </h2>
            {inspecciones.length === 0 ? (
              <EmptyState icon="fact_check" title="Todavia no hay ninguna inspeccion" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Plan</TH>
                    <TH>Resultado</TH>
                    <TH>Fecha</TH>
                  </TR>
                </THead>
                <TBody>
                  {inspecciones.map((i) => (
                    <TR key={i.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <a
                          href={`/calidad/inspecciones/${i.id}${qs}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {i.plan_name}
                        </a>
                        {i.product_name && (
                          <span className="ml-1.5 text-[var(--color-text-muted)]">
                            · {i.product_name}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={badgeResultado(i.result)}>
                          {RESULTADO_INSPECCION[i.result] ?? i.result}
                        </Badge>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        <Mono>{fecha(i.performed_at)}</Mono>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              No conformidades abiertas
            </h2>
            {noConformidades.length === 0 ? (
              <EmptyState icon="report" title="No hay ninguna no conformidad abierta" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Descripcion</TH>
                    <TH>Severidad</TH>
                    <TH>Estado</TH>
                    <TH numeric>Dias</TH>
                  </TR>
                </THead>
                <TBody>
                  {noConformidades.map((nc) => (
                    <TR key={nc.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <a
                          href={`/calidad/no-conformidades/${nc.id}${qs}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {nc.description}
                        </a>
                      </TD>
                      <TD>
                        <Badge tone={badgeSeveridad(nc.severity)}>
                          {SEVERIDAD_NC[nc.severity] ?? nc.severity}
                        </Badge>
                      </TD>
                      <TD>
                        <Badge tone="neutral">{ESTADO_NC[nc.status] ?? nc.status}</Badge>
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {diasAbierto(new Date(nc.detected_at), new Date())}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}
