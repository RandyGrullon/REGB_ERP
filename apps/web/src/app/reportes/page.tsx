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
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { FUENTES_REPORTE } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  agregarItemDashboardForm,
  alternarExportForm,
  crearDashboardForm,
  crearExportForm,
  crearReporteForm,
  ejecutarExportAhoraForm,
} from './actions'
import { ESTADO_EXPORT, FRECUENCIA_EXPORT, TIPO_GRAFICO } from './estados'
import { FUENTE_LABEL } from './reportSources'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'BI & Reportes · REGB ERP' }

interface ReporteFila {
  id: string
  name: string
  source_key: string
  chart_type: string
}

interface DashboardFila {
  id: string
  name: string
  reportes: string
  items: { id: string; name: string }[] | null
}

interface ExportFila {
  id: string
  report_name: string
  frequency: string
  recipients: string
  status: string
  next_run_at: string
  last_run_at: string | null
}

/** BI & Reportes (modulo 87): el constructor visual elige entre un catalogo fijo de fuentes ya vetadas. */
export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'bi')

  const { reportes, dashboards, exports } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const r = await tx<ReporteFila[]>`
      select id, name, source_key, chart_type from public.report_definitions
      where tenant_id = ${ctx.tenantId} order by created_at desc`
    const d = await tx<DashboardFila[]>`
      select db.id, db.name,
             (select count(*)::text from public.dashboard_items where dashboard_id = db.id) as reportes,
             (select json_agg(json_build_object('id', rd.id, 'name', rd.name) order by di.position)
                from public.dashboard_items di
                join public.report_definitions rd on rd.id = di.report_id
               where di.dashboard_id = db.id) as items
      from public.dashboards db where db.tenant_id = ${ctx.tenantId} order by db.created_at desc`
    const e = await tx<ExportFila[]>`
      select se.id, rd.name as report_name, se.frequency, se.recipients, se.status,
             se.next_run_at::text, se.last_run_at::text
      from public.scheduled_exports se
      join public.report_definitions rd on rd.id = se.report_id
      where se.tenant_id = ${ctx.tenantId} order by se.next_run_at`
    return { reportes: r, dashboards: d, exports: e }
  })

  const puedeGestionar = exigir(ctx, 'bi', 'bi.manage').ok
  const qs = ctx.demoQs
  const ahora = new Date()
  const fechaHora = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Santo_Domingo',
    })


  return (
    <Shell {...shell} activePath="/reportes">
      <div className="space-y-5">
        <PageHeader
          icon="bar_chart"
          title="BI & Reportes"
          description="Arma reportes con las fuentes ya preparadas del sistema, júntalos en tableros y programa su envío."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Reportes guardados" value={String(reportes.length)} />
          <StatCard label="Tableros" value={String(dashboards.length)} />
          <StatCard label="Envíos programados" value={String(exports.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Reportes guardados</CardTitle>
          </CardHeader>
          <CardBody>
            {reportes.length === 0 ? (
              <EmptyState
                icon="bar_chart"
                title="Todavía no hay ningún reporte"
                description="Crea el primero abajo: elige de dónde salen los datos y cómo quieres verlos."
              />
            ) : (
              <Table className="min-w-[520px]">
                <THead>
                  <TR>
                    <TH>Reporte</TH>
                    <TH>Fuente</TH>
                    <TH>Gráfico</TH>
                  </TR>
                </THead>
                <TBody>
                  {reportes.map((r) => (
                    <TR key={r.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <a
                          href={`/reportes/${r.id}${qs}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {r.name}
                        </a>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {FUENTE_LABEL[r.source_key as keyof typeof FUENTE_LABEL] ?? r.source_key}
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {TIPO_GRAFICO[r.chart_type] ?? r.chart_type}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && (
              <form action={crearReporteForm} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    placeholder="Ventas de la semana"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fuente
                  <select
                    name="sourceKey"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {FUENTES_REPORTE.map((f) => (
                      <option key={f} value={f}>
                        {FUENTE_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Gráfico
                  <select
                    name="chartType"
                    defaultValue="table"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="table">Tabla</option>
                    <option value="bar">Barras</option>
                    <option value="line">Línea</option>
                  </select>
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Días (opcional)
                  <input
                    name="days"
                    inputMode="numeric"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Límite (opcional)
                  <input
                    name="limit"
                    inputMode="numeric"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tableros</CardTitle>
          </CardHeader>
          <CardBody>
            {dashboards.length === 0 ? (
              <EmptyState
                icon="dashboard"
                title="Todavía no hay ningún tablero"
                description="Un tablero junta varios reportes en un solo lugar. Crea el primero abajo."
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {dashboards.map((d) => (
                  <li key={d.id} className="py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {d.name}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {d.reportes} {Number(d.reportes) === 1 ? 'reporte' : 'reportes'}
                      </span>
                    </div>
                    {d.items && d.items.length > 0 && (
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {d.items.map((it) => (
                          <li key={it.id}>
                            <a
                              href={`/reportes/${it.id}${qs}`}
                              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-link)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                            >
                              <Icon name="bar_chart" size={14} />
                              {it.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {puedeGestionar && (
              <div className="mt-4 flex flex-wrap gap-6">
                <form action={crearDashboardForm} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Nuevo tablero
                    <input
                      name="name"
                      required
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="add" size={14} />
                    Crear
                  </BotonEnvio>
                </form>

                {dashboards.length > 0 && reportes.length > 0 && (
                  <form
                    action={agregarItemDashboardForm}
                    className="flex flex-wrap items-end gap-3"
                  >
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Agregar a
                      <select
                        name="dashboardId"
                        required
                        className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                      >
                        {dashboards.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Reporte
                      <select
                        name="reportId"
                        required
                        className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                      >
                        {reportes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="add" size={14} />
                      Agregar
                    </BotonEnvio>
                  </form>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Envíos programados</CardTitle>
          </CardHeader>
          <CardBody>
            {exports.length === 0 ? (
              <EmptyState
                icon="schedule_send"
                title="Todavía no hay ningún envío programado"
                description="Programa el primero abajo: el reporte, cada cuánto y a qué correos."
              />
            ) : (
              <Table className="min-w-[860px]">
                <THead>
                  <TR>
                    <TH>Reporte</TH>
                    <TH>Frecuencia</TH>
                    <TH>Destinatarios</TH>
                    <TH>Próximo envío</TH>
                    <TH>Estado</TH>
                    <TH>
                      <span className="sr-only">Acción</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {exports.map((e) => (
                    <TR key={e.id}>
                      <TD className="text-[var(--color-text-primary)]">{e.report_name}</TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {FRECUENCIA_EXPORT[e.frequency] ?? e.frequency}
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        <Mono>{e.recipients}</Mono>
                      </TD>
                      <TD className="whitespace-nowrap text-[var(--color-text-muted)]">
                        {fechaHora(e.next_run_at)}
                        {e.status === 'active' && new Date(e.next_run_at) < ahora && (
                          <span className="block text-xs text-[var(--color-semantic-text-warning)]">
                            atrasado: ejecútalo ahora
                          </span>
                        )}
                        {e.last_run_at && (
                          <span className="block text-xs">último: {fechaHora(e.last_run_at)}</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={e.status === 'active' ? 'success' : 'neutral'}>
                          {ESTADO_EXPORT[e.status] ?? e.status}
                        </Badge>
                      </TD>
                      <TD>
                        {puedeGestionar && (
                          <div className="flex gap-2">
                            <form action={ejecutarExportAhoraForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="exportId" value={e.id} />
                              <BotonEnvio className="flex h-7 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                                Ejecutar ahora
                              </BotonEnvio>
                            </form>
                            <form action={alternarExportForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="exportId" value={e.id} />
                              <input
                                type="hidden"
                                name="siguiente"
                                value={e.status === 'active' ? 'paused' : 'active'}
                              />
                              <BotonEnvio className="flex h-7 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                                {e.status === 'active' ? 'Pausar' : 'Reanudar'}
                              </BotonEnvio>
                            </form>
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && reportes.length > 0 && (
              <form action={crearExportForm} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Reporte
                  <select
                    name="reportId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {reportes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Frecuencia
                  <select
                    name="frequency"
                    defaultValue="weekly"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="daily">Diaria</option>
                    <option value="weekly">Semanal</option>
                    <option value="monthly">Mensual</option>
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Destinatarios
                  <input
                    name="recipients"
                    required
                    placeholder="correo@ejemplo.do"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Programar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lo que esto no hace</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              Los reportes salen de un catálogo fijo de fuentes ya preparadas: no se pueden escribir
              consultas a mano, así nunca se cuelan datos de otra empresa. Un envío programado
              guarda su calendario y se puede ejecutar a mano, pero el correo todavía no sale solo.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
