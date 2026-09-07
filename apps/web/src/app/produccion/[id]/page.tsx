import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import { progresoResultadoClave, tasaMerma } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  cancelarOrdenForm,
  liberarOrdenForm,
  reportarAvanceForm,
} from '../actions'
import { ESTADO_ORDEN } from '../estados'

export const dynamic = 'force-dynamic'

interface OrdenHead {
  id: string
  status: string
  sku: string
  product_name: string
  warehouse_name: string
  qty_planned: string
  qty_completed: string
  qty_scrapped: string
}

interface LineaRow {
  id: string
  sku: string
  name: string
  qty_required: string
  qty_consumed: string
}

interface ReporteRow {
  id: string
  qty_completed_delta: string
  qty_scrapped_delta: string
  reported_at: string
  notes: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 3 })

/** Detalle de una orden de produccion (modulo 56): liberar, reportar avance y mermas. */
export default async function OrdenDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'manufacturing')

  const { head, lineas, reportes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OrdenHead[]>`
      select po.id, po.status, p.sku, p.name as product_name, w.name as warehouse_name,
             po.qty_planned::text, po.qty_completed::text, po.qty_scrapped::text
      from public.production_orders po
      join public.bill_of_materials bm on bm.id = po.bom_id
      join public.products p on p.id = bm.product_id
      join public.warehouses w on w.id = po.warehouse_id
      where po.id = ${id} and po.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, lineas: [], reportes: [] }

    const l = await tx<LineaRow[]>`
      select l.id, p.sku, p.name, l.qty_required::text, l.qty_consumed::text
      from public.production_order_lines l
      join public.products p on p.id = l.component_product_id
      where l.order_id = ${id} and l.tenant_id = ${ctx.tenantId}
      order by p.name`

    const r = await tx<ReporteRow[]>`
      select id, qty_completed_delta::text, qty_scrapped_delta::text, reported_at::text, notes
      from public.production_reports
      where order_id = ${id} and tenant_id = ${ctx.tenantId}
      order by reported_at desc`

    return { head: h, lineas: l, reportes: r }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'manufacturing', 'manufacturing.manage').ok
  const puedeReportar = exigir(ctx, 'manufacturing', 'manufacturing.report').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="orderId" value={head.id} />
    </>
  )

  const enBorrador = head.status === 'draft'
  const puedeReportarAhora = head.status === 'released' || head.status === 'in_progress'
  const progreso = progresoResultadoClave(Number(head.qty_completed), Number(head.qty_planned))
  const merma = tasaMerma(Number(head.qty_scrapped), Number(head.qty_completed))

  return (
    <Shell {...shell} activePath="/produccion">
      <div className="space-y-5">
        <PageHeader
          icon="precision_manufacturing"
          title={`${head.sku} · ${head.product_name}`}
          description={`Almacen: ${head.warehouse_name}`}
          crumbs={[{ label: 'Ordenes de produccion', href: `/produccion${qs}` }, { label: head.sku }]}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={head.status === 'completed' ? 'success' : head.status === 'cancelled' ? 'danger' : 'warning'}>
                {ESTADO_ORDEN[head.status] ?? head.status}
              </Badge>
              {enBorrador && puedeGestionar && (
                <>
                  <form action={liberarOrdenForm}>
                    {campos}
                    <button type="submit" className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                      <Icon name="rocket_launch" size={14} />
                      Liberar
                    </button>
                  </form>
                  <form action={cancelarOrdenForm}>
                    {campos}
                    <button type="submit" className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="cancel" size={14} />
                      Cancelar
                    </button>
                  </form>
                </>
              )}
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Planificado" value={head.qty_planned} />
          <StatCard label="Completado" value={head.qty_completed} />
          <StatCard label="Merma" value={head.qty_scrapped} />
          <StatCard label="Avance" value={`${progreso}%`} hint={`${Math.round(merma * 100)}% en merma`} />
        </section>

        {lineas.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Componentes consumidos</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Componente</TH>
                    <TH numeric>Requerido</TH>
                    <TH numeric>Consumido</TH>
                  </TR>
                </THead>
                <TBody>
                  {lineas.map((l) => (
                    <TR key={l.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <Mono>{l.sku}</Mono> {l.name}
                      </TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(l.qty_required))}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(l.qty_consumed))}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Reportes de avance</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {reportes.length === 0 ? (
              <p className="p-4 text-sm text-[var(--color-text-muted)]">Todavia no hay ningun reporte.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH numeric>Completado</TH>
                    <TH numeric>Merma</TH>
                    <TH>Notas</TH>
                  </TR>
                </THead>
                <TBody>
                  {reportes.map((r) => (
                    <TR key={r.id}>
                      <TD>{new Date(r.reported_at).toLocaleString('es-DO')}</TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-semantic-text-success)]">
                          {r.qty_completed_delta}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-semantic-text-danger)]">
                          {r.qty_scrapped_delta}
                        </span>
                      </TD>
                      <TD className="max-w-48 truncate">{r.notes ?? '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {puedeReportarAhora && puedeReportar && (
              <form action={reportarAvanceForm} className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] p-3">
                {campos}
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Completado
                  <input name="qtyCompletedDelta" inputMode="decimal" defaultValue="0" className="tabular h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Merma
                  <input name="qtyScrappedDelta" inputMode="decimal" defaultValue="0" className="tabular h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Notas
                  <input name="notes" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <button type="submit" className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="fact_check" size={14} />
                  Reportar
                </button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
