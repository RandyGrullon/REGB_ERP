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
import { equipoRequiereMantenimiento } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADO_ORDEN, PRIORIDAD_ORDEN, TIPO_ORDEN } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mantenimiento de equipos · REGB ERP' }

interface EquipoRow {
  id: string
  code: string
  name: string
  location: string | null
  usage_hours: string
  last_service_usage: string | null
  maintenance_interval_usage: string | null
  last_service_at: string | null
  maintenance_interval_days: number | null
  status: string
}

interface OrdenRow {
  id: string
  equipment_name: string
  type: string
  status: string
  priority: string
  description: string
  opened_at: string
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' })

const badgeEstado = (s: string): 'success' | 'warning' | 'neutral' => {
  if (s === 'completed') return 'success'
  if (s === 'open' || s === 'in_progress') return 'warning'
  return 'neutral'
}

const badgePrioridad = (p: string): 'neutral' | 'warning' | 'danger' => {
  if (p === 'urgent') return 'danger'
  if (p === 'high') return 'warning'
  return 'neutral'
}

/** Mantenimiento / CMMS (modulo 59): equipos, ordenes de trabajo y MTBF. */
export default async function MantenimientoPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'maintenance')

  const { ordenesAbiertas, equipos, equiposActivos } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const o = await tx<OrdenRow[]>`
      select wo.id, e.name as equipment_name, wo.type, wo.status, wo.priority, wo.description, wo.opened_at::text
      from public.work_orders wo
      join public.equipment e on e.id = wo.equipment_id
      where wo.tenant_id = ${ctx.tenantId} and wo.status in ('open', 'in_progress')
      order by wo.opened_at desc`
      const eq = await tx<EquipoRow[]>`
      select id, code, name, location, usage_hours::text, last_service_usage::text,
             maintenance_interval_usage::text, last_service_at::text, maintenance_interval_days, status
      from public.equipment
      where tenant_id = ${ctx.tenantId} and status = 'active'
      order by name`
      const [ea] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.equipment where tenant_id = ${ctx.tenantId} and status = 'active'`

      return { ordenesAbiertas: o, equipos: eq, equiposActivos: Number(ea?.n ?? 0) }
    },
  )

  const listaVencidos = equipos.filter((e) =>
    equipoRequiereMantenimiento(
      Number(e.usage_hours),
      Number(e.last_service_usage ?? 0),
      Number(e.maintenance_interval_usage ?? Infinity),
      e.maintenance_interval_days && e.last_service_at
        ? new Date(new Date(e.last_service_at).getTime() + e.maintenance_interval_days * 86_400_000)
        : null,
      new Date(),
    ),
  )
  const vencidos = listaVencidos.length

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/mantenimiento">
      <div className="space-y-5">
        <PageHeader
          icon="build"
          title="Mantenimiento de equipos"
          description="Los equipos del negocio (compresor, montacargas, planta eléctrica…), cuándo les toca servicio por horas de uso o por fecha, y las órdenes de trabajo abiertas."
          actions={
            <a
              href={`/mantenimiento/equipos${qs}`}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
            >
              Equipos
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Equipos activos" value={String(equiposActivos)} />
          <StatCard label="Les toca servicio" value={String(vencidos)} hint="por uso o por fecha" />
          <StatCard
            label="Órdenes abiertas"
            value={String(ordenesAbiertas.length)}
            hint="averías y servicios"
          />
        </section>

        {listaVencidos.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Equipos a los que les toca servicio
            </h2>
            <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
              {listaVencidos.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <a
                    href={`/mantenimiento/equipos/${e.id}${qs}`}
                    className="text-sm text-[var(--color-text-primary)] underline-offset-2 hover:underline"
                  >
                    <Mono>{e.code}</Mono> {e.name}
                    {e.location && (
                      <span className="text-[var(--color-text-muted)]"> · {e.location}</span>
                    )}
                  </a>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {e.last_service_at
                      ? `último servicio el ${new Date(e.last_service_at).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
                      : 'sin servicio registrado'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {ordenesAbiertas.length === 0 ? (
          <EmptyState
            icon="build"
            title="No hay ninguna orden de trabajo abierta"
            description="Cuando un equipo se dañe o le toque su servicio, abre la orden desde la ficha del equipo, en Equipos."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Equipo</TH>
                <TH>Tipo</TH>
                <TH>Descripción</TH>
                <TH>Prioridad</TH>
                <TH>Estado</TH>
                <TH>Abierta</TH>
              </TR>
            </THead>
            <TBody>
              {ordenesAbiertas.map((o) => (
                <TR key={o.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a
                      href={`/mantenimiento/ordenes/${o.id}${qs}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {o.equipment_name}
                    </a>
                  </TD>
                  <TD>{TIPO_ORDEN[o.type] ?? o.type}</TD>
                  <TD className="max-w-72 text-[var(--color-text-secondary)]">
                    <span className="line-clamp-2">{o.description}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgePrioridad(o.priority)}>
                      {PRIORIDAD_ORDEN[o.priority] ?? o.priority}
                    </Badge>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(o.status)}>{ESTADO_ORDEN[o.status] ?? o.status}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-[var(--color-text-muted)]">
                    {fecha(o.opened_at)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
