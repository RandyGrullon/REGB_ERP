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
import { equipoRequiereMantenimiento } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearEquipoForm } from '../actions'
import { ESTADO_EQUIPO } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Equipos · REGB ERP' }

interface EquipoRow {
  id: string
  code: string
  name: string
  location: string | null
  status: string
  usage_hours: string
  last_service_usage: string | null
  maintenance_interval_usage: string | null
  last_service_at: string | null
  maintenance_interval_days: number | null
}

/** Equipos a mantener (modulo 59): uso acumulado, intervalos y vencimiento real. */
export default async function EquiposPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'maintenance', 'maintenance.manage')

  const equipos = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<EquipoRow[]>`
      select id, code, name, location, status, usage_hours::text, last_service_usage::text,
             maintenance_interval_usage::text, last_service_at::text, maintenance_interval_days
      from public.equipment
      where tenant_id = ${ctx.tenantId}
      order by name`,
  )

  const puedeGestionar = exigir(ctx, 'maintenance', 'maintenance.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/mantenimiento/equipos">
      <div className="space-y-5">
        <PageHeader
          icon="precision_manufacturing"
          title="Equipos"
          description="Cada equipo con sus horas de uso y cada cuánto le toca servicio (por horas, por días o las dos cosas)."
          crumbs={[
            { label: 'Mantenimiento de equipos', href: `/mantenimiento${qs}` },
            { label: 'Equipos' },
          ]}
        />

        {equipos.length === 0 ? (
          <EmptyState
            icon="precision_manufacturing"
            title="Todavía no hay ningún equipo"
            description="Registra abajo el primero con su código, dónde está y cada cuánto le toca servicio: el sistema te avisa cuando se venza."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Equipo</TH>
                <TH>Ubicación</TH>
                <TH numeric>Horas de uso</TH>
                <TH>Último servicio</TH>
                <TH>Estado</TH>
                <TH>Mantenimiento</TH>
              </TR>
            </THead>
            <TBody>
              {equipos.map((e) => {
                const fechaLimite =
                  e.maintenance_interval_days && e.last_service_at
                    ? new Date(
                        new Date(e.last_service_at).getTime() +
                          e.maintenance_interval_days * 86_400_000,
                      )
                    : null
                const vencido = equipoRequiereMantenimiento(
                  Number(e.usage_hours),
                  Number(e.last_service_usage ?? 0),
                  Number(e.maintenance_interval_usage ?? Infinity),
                  fechaLimite,
                  new Date(),
                )
                return (
                  <TR key={e.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <a
                        href={`/mantenimiento/equipos/${e.id}${qs}`}
                        className="underline-offset-2 hover:underline"
                      >
                        <Mono>{e.code}</Mono> {e.name}
                      </a>
                    </TD>
                    <TD className="text-[var(--color-text-muted)]">{e.location ?? '—'}</TD>
                    <TD numeric>
                      <span className="tabular">
                        {Number(e.usage_hours).toLocaleString('es-DO')} h
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-[var(--color-text-muted)]">
                      {e.last_service_at
                        ? new Date(e.last_service_at).toLocaleDateString('es-DO', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })
                        : 'Nunca'}
                    </TD>
                    <TD>
                      <Badge tone={e.status === 'active' ? 'success' : 'neutral'}>
                        {ESTADO_EQUIPO[e.status] ?? e.status}
                      </Badge>
                    </TD>
                    <TD>
                      {vencido ? (
                        <Badge tone="danger">Le toca servicio</Badge>
                      ) : (
                        <Badge tone="success">Al día</Badge>
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
              <CardTitle>Nuevo equipo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearEquipoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Código
                  <input
                    name="code"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Ubicación (opcional)
                  <input
                    name="location"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cada cuántas horas (opcional)
                  <input
                    name="maintenanceIntervalUsage"
                    inputMode="decimal"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cada cuántos días (opcional)
                  <input
                    name="maintenanceIntervalDays"
                    inputMode="numeric"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
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
