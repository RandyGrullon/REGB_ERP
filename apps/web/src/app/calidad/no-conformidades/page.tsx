import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  PageHeader,
} from '@regb/ui'
import { diasAbierto } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { abrirNoConformidadForm } from '../actions'
import { ESTADO_NC, SEVERIDAD_NC } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'No conformidades · REGB ERP' }

interface NcRow {
  id: string
  description: string
  severity: string
  status: string
  detected_at: string
}

const badgeSeveridad = (s: string): 'neutral' | 'warning' | 'danger' => {
  if (s === 'critical') return 'danger'
  if (s === 'major') return 'warning'
  return 'neutral'
}

const badgeEstado = (s: string): 'success' | 'warning' | 'neutral' => {
  if (s === 'closed') return 'success'
  if (s === 'dismissed') return 'neutral'
  return 'warning'
}

/** No conformidades (modulo 58): defectos que solo se cierran pasando por un CAPA. */
export default async function NoConformidadesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'quality')

  const noConformidades = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<NcRow[]>`
      select id, description, severity, status, detected_at::text
      from public.non_conformances
      where tenant_id = ${ctx.tenantId}
      order by detected_at desc`,
  )

  const puedeInspeccionar = exigir(ctx, 'quality', 'quality.inspect').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/calidad/no-conformidades">
      <div className="space-y-5">
        <PageHeader
          icon="report"
          title="No conformidades"
          description="Cada problema de calidad encontrado: se investiga, se le busca la causa raíz y no se cierra hasta que su acción correctiva esté verificada."
          crumbs={[
            { label: 'Control de calidad', href: `/calidad${qs}` },
            { label: 'No conformidades' },
          ]}
        />

        {noConformidades.length === 0 ? (
          <EmptyState
            icon="report"
            title="Todavía no hay ninguna no conformidad"
            description="Si una inspección falla o alguien encuentra un defecto, ábrela abajo con su severidad para darle seguimiento."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Descripción</TH>
                <TH>Detectada</TH>
                <TH>Severidad</TH>
                <TH>Estado</TH>
                <TH numeric>Días abierta</TH>
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
                  <TD className="whitespace-nowrap">
                    {new Date(nc.detected_at).toLocaleDateString('es-DO', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </TD>
                  <TD>
                    <Badge tone={badgeSeveridad(nc.severity)}>
                      {SEVERIDAD_NC[nc.severity] ?? nc.severity}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(nc.status)}>{ESTADO_NC[nc.status] ?? nc.status}</Badge>
                  </TD>
                  <TD numeric>
                    <span className="tabular">
                      {nc.status === 'closed' || nc.status === 'dismissed'
                        ? '—'
                        : diasAbierto(new Date(nc.detected_at), new Date())}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeInspeccionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva no conformidad</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={abrirNoConformidadForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripción
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
                    <option value="critical">Crítica</option>
                  </select>
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
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
