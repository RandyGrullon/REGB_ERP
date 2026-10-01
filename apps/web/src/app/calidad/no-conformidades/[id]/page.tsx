import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import { diasAbierto, type EstadoCapa, type EstadoNoConformidad } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearCapaForm, transicionarCapaForm, transicionarNoConformidadForm } from '../../actions'
import { ESTADO_CAPA, ESTADO_NC, SEVERIDAD_NC } from '../../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface NcHead {
  id: string
  description: string
  severity: string
  status: EstadoNoConformidad
  detected_at: string
  inspection_id: string | null
  detectada_por: string | null
  plan_name: string | null
  product_name: string | null
}

interface CapaRow {
  id: string
  root_cause: string
  corrective_action: string
  preventive_action: string | null
  status: EstadoCapa
  due_date: string | null
  verified_at: string | null
}

const badgeSeveridad = (s: string): 'neutral' | 'warning' | 'danger' => {
  if (s === 'critical') return 'danger'
  if (s === 'major') return 'warning'
  return 'neutral'
}

const botonClase =
  'flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })

/** Detalle de una no conformidad (modulo 58): su maquina de estados y su CAPA. */
export default async function NoConformidadDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'quality')

  const { head, capa } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<NcHead[]>`
      select nc.id, nc.description, nc.severity, nc.status, nc.detected_at::text, nc.inspection_id,
             up.display_name as detectada_por, ip.name as plan_name, pr.name as product_name
      from public.non_conformances nc
      left join public.user_profiles up
        on up.tenant_id = nc.tenant_id and up.user_id = nc.detected_by
      left join public.inspections insp on insp.id = nc.inspection_id
      left join public.inspection_plans ip on ip.id = insp.plan_id
      left join public.products pr on pr.id = insp.product_id
      where nc.id = ${id} and nc.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, capa: null }

    const [c] = await tx<CapaRow[]>`
      select id, root_cause, corrective_action, preventive_action, status,
             due_date::text, verified_at::text
      from public.capas
      where non_conformance_id = ${id} and tenant_id = ${ctx.tenantId}
      order by created_at desc limit 1`

    return { head: h, capa: c ?? null }
  })

  if (!head) notFound()

  const puedeResolver = exigir(ctx, 'quality', 'quality.inspect').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="ncId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/calidad/no-conformidades">
      <div className="space-y-5">
        <PageHeader
          icon="report"
          title={head.description}
          description={[
            `Detectada el ${fecha(head.detected_at)}`,
            head.detectada_por ? `por ${head.detectada_por}` : null,
            head.plan_name
              ? `en la inspección «${head.plan_name}»${head.product_name ? ` de ${head.product_name}` : ''}`
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
          crumbs={[
            { label: 'Control de calidad', href: `/calidad${qs}` },
            { label: 'No conformidades', href: `/calidad/no-conformidades${qs}` },
            { label: 'Detalle' },
          ]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={badgeSeveridad(head.severity)}>
                {SEVERIDAD_NC[head.severity] ?? head.severity}
              </Badge>
              <Badge
                tone={
                  head.status === 'closed'
                    ? 'success'
                    : head.status === 'dismissed'
                      ? 'neutral'
                      : head.status === 'capa_created'
                        ? 'info'
                        : 'warning'
                }
              >
                {ESTADO_NC[head.status] ?? head.status}
              </Badge>
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Días abierta"
            value={String(diasAbierto(new Date(head.detected_at), new Date()))}
            hint={`desde el ${fecha(head.detected_at)}`}
          />
          <StatCard
            label="Acción correctiva"
            value={capa ? (ESTADO_CAPA[capa.status] ?? capa.status) : 'Sin crear'}
            hint={
              capa?.due_date
                ? `vence el ${new Date(capa.due_date).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
                : capa
                  ? 'sin fecha límite'
                  : 'se crea al investigar'
            }
          />
        </section>
        {head.inspection_id && (
          <a
            href={`/calidad/inspecciones/${head.inspection_id}${qs}`}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-link)] underline-offset-2 hover:underline"
          >
            <Icon name="fact_check" size={14} />
            Ver la inspección que la originó
          </a>
        )}

        {puedeResolver && head.status === 'open' && (
          <div className="flex gap-2">
            <form action={transicionarNoConformidadForm}>
              {campos}
              <input type="hidden" name="siguiente" value="investigating" />
              <BotonEnvio className={botonClase}>
                <Icon name="search" size={14} />
                Empezar a investigar
              </BotonEnvio>
            </form>
            <form action={transicionarNoConformidadForm}>
              {campos}
              <input type="hidden" name="siguiente" value="dismissed" />
              <BotonEnvio className={botonSecundarioClase}>
                Descartar: no es un defecto real
              </BotonEnvio>
            </form>
          </div>
        )}

        {puedeResolver && head.status === 'investigating' && !capa && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <form action={transicionarNoConformidadForm}>
                {campos}
                <input type="hidden" name="siguiente" value="dismissed" />
                <BotonEnvio className={botonSecundarioClase}>
                  Descartar: se investigó y no era un defecto real
                </BotonEnvio>
              </form>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Acción correctiva y preventiva</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={crearCapaForm} className="space-y-3">
                  {campos}
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Causa raíz
                    <textarea
                      name="rootCause"
                      required
                      rows={2}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Acción correctiva
                    <textarea
                      name="correctiveAction"
                      required
                      rows={2}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Acción preventiva (opcional)
                    <textarea
                      name="preventiveAction"
                      rows={2}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <label className="flex w-48 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Fecha límite (opcional)
                    <input
                      type="date"
                      name="dueDate"
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <BotonEnvio className={botonClase}>
                    <Icon name="add_task" size={14} />
                    Crear acción correctiva
                  </BotonEnvio>
                </form>
              </CardBody>
            </Card>
          </div>
        )}

        {capa && (
          <Card>
            <CardHeader>
              <CardTitle>
                Acción correctiva{' '}
                <Badge tone={capa.status === 'closed' ? 'success' : 'warning'}>
                  {ESTADO_CAPA[capa.status]}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-muted)]">Causa raíz</p>
                <p className="text-sm text-[var(--color-text-primary)]">{capa.root_cause}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                  Acción correctiva
                </p>
                <p className="text-sm text-[var(--color-text-primary)]">{capa.corrective_action}</p>
              </div>
              {capa.preventive_action && (
                <div>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                    Acción preventiva
                  </p>
                  <p className="text-sm text-[var(--color-text-primary)]">
                    {capa.preventive_action}
                  </p>
                </div>
              )}
              {capa.due_date && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Fecha límite:{' '}
                  {new Date(capa.due_date).toLocaleDateString('es-DO', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </p>
              )}

              {puedeResolver && capa.status !== 'closed' && (
                <form action={transicionarCapaForm} className="pt-2">
                  {campos}
                  <input type="hidden" name="capaId" value={capa.id} />
                  <input
                    type="hidden"
                    name="siguiente"
                    value={
                      capa.status === 'open'
                        ? 'in_progress'
                        : capa.status === 'in_progress'
                          ? 'verified'
                          : 'closed'
                    }
                  />
                  <BotonEnvio className={botonClase}>
                    <Icon name="arrow_forward" size={14} />
                    {capa.status === 'open' && 'Marcar en progreso'}
                    {capa.status === 'in_progress' && 'Marcar verificada'}
                    {capa.status === 'verified' && 'Cerrar acción correctiva'}
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
