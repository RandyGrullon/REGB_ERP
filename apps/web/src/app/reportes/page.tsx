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
      select db.id, db.name, (select count(*)::text from public.dashboard_items where dashboard_id = db.id) as reportes
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

  return (
    <Shell {...shell} activePath="/reportes">
      <div className="space-y-5">
        <PageHeader
          icon="bar_chart"
          title="BI & Reportes"
          description="El constructor visual elige entre un catalogo fijo de fuentes ya vetadas -nunca acepta SQL libre-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Reportes guardados" value={String(reportes.length)} />
          <StatCard label="Dashboards" value={String(dashboards.length)} />
          <StatCard label="Exports programados" value={String(exports.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Reportes guardados</CardTitle>
          </CardHeader>
          <CardBody>
            {reportes.length === 0 ? (
              <EmptyState icon="bar_chart" title="Todavia no hay ningun reporte" description="Crea el primero abajo." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Reporte</TH>
                    <TH>Fuente</TH>
                    <TH>Grafico</TH>
                  </TR>
                </THead>
                <TBody>
                  {reportes.map((r) => (
                    <TR key={r.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <a href={`/reportes/${r.id}${qs}`} className="underline-offset-2 hover:underline">
                          {r.name}
                        </a>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">{FUENTE_LABEL[r.source_key as keyof typeof FUENTE_LABEL] ?? r.source_key}</TD>
                      <TD className="text-[var(--color-text-muted)]">{TIPO_GRAFICO[r.chart_type] ?? r.chart_type}</TD>
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
                  Grafico
                  <select
                    name="chartType"
                    defaultValue="table"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="table">Tabla</option>
                    <option value="bar">Barras</option>
                    <option value="line">Linea</option>
                  </select>
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Dias (opcional)
                  <input
                    name="days"
                    inputMode="numeric"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Limite (opcional)
                  <input
                    name="limit"
                    inputMode="numeric"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dashboards</CardTitle>
          </CardHeader>
          <CardBody>
            {dashboards.length === 0 ? (
              <EmptyState icon="dashboard" title="Todavia no hay ningun dashboard" description="Crea el primero abajo." />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {dashboards.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2">
                    <span className="text-sm text-[var(--color-text-primary)]">{d.name}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{d.reportes} reporte(s)</span>
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
                    Nuevo dashboard
                    <input
                      name="name"
                      required
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="add" size={14} />
                    Crear
                  </BotonEnvio>
                </form>

                {dashboards.length > 0 && reportes.length > 0 && (
                  <form action={agregarItemDashboardForm} className="flex flex-wrap items-end gap-3">
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
                    <BotonEnvio
                      
                      className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
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
            <CardTitle>Exports programados</CardTitle>
          </CardHeader>
          <CardBody>
            {exports.length === 0 ? (
              <EmptyState icon="schedule_send" title="Todavia no hay ningun export programado" description="Programa el primero abajo." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Reporte</TH>
                    <TH>Frecuencia</TH>
                    <TH>Destinatarios</TH>
                    <TH>Proxima ejecucion</TH>
                    <TH>Estado</TH>
                    <TH>
                      <span className="sr-only">Accion</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {exports.map((e) => (
                    <TR key={e.id}>
                      <TD className="text-[var(--color-text-primary)]">{e.report_name}</TD>
                      <TD className="text-[var(--color-text-muted)]">{FRECUENCIA_EXPORT[e.frequency] ?? e.frequency}</TD>
                      <TD className="text-[var(--color-text-muted)]">
                        <Mono>{e.recipients}</Mono>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">{new Date(e.next_run_at).toLocaleString('es-DO')}</TD>
                      <TD>
                        <Badge tone={e.status === 'active' ? 'success' : 'neutral'}>{ESTADO_EXPORT[e.status] ?? e.status}</Badge>
                      </TD>
                      <TD>
                        {puedeGestionar && (
                          <div className="flex gap-2">
                            <form action={ejecutarExportAhoraForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="exportId" value={e.id} />
                              <BotonEnvio
                                
                                className="flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                                Ejecutar ahora
                              </BotonEnvio>
                            </form>
                            <form action={alternarExportForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="exportId" value={e.id} />
                              <input type="hidden" name="siguiente" value={e.status === 'active' ? 'paused' : 'active'} />
                              <BotonEnvio
                                
                                className="flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
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
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
              El constructor visual elige entre un catalogo fijo de fuentes ya vetadas -nunca acepta una
              consulta libre que pudiera filtrar datos de otro cliente-. Un export programado registra su
              calendario, pero el envio real por correo todavia no esta conectado.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
