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
    <Shell {...shell} activePath="/calidad">
      <div className="space-y-5">
        <PageHeader
          icon="report"
          title="No conformidades"
          description="Una no conformidad no se cierra directo: pasa por un CAPA con causa raiz, accion correctiva y verificacion."
          crumbs={[{ label: 'Control de calidad', href: `/calidad${qs}` }, { label: 'No conformidades' }]}
        />

        {noConformidades.length === 0 ? (
          <EmptyState icon="report" title="Todavia no hay ninguna no conformidad" description="" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Descripcion</TH>
                <TH>Severidad</TH>
                <TH>Estado</TH>
                <TH numeric>Dias abierta</TH>
              </TR>
            </THead>
            <TBody>
              {noConformidades.map((nc) => (
                <TR key={nc.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/calidad/no-conformidades/${nc.id}${qs}`} className="underline-offset-2 hover:underline">
                      {nc.description}
                    </a>
                  </TD>
                  <TD>
                    <Badge tone={badgeSeveridad(nc.severity)}>{SEVERIDAD_NC[nc.severity] ?? nc.severity}</Badge>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(nc.status)}>{ESTADO_NC[nc.status] ?? nc.status}</Badge>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{diasAbierto(new Date(nc.detected_at), new Date())}</span>
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
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="add" size={14} />
                  Abrir
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
