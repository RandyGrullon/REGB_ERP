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
import {
  calcularOee,
  calidadOee,
  disponibilidad,
  horasInactivoTotal,
  rendimiento,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADO_ORDEN_TERMINAL } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Piso de planta · REGB ERP' }

interface OrdenRow {
  id: string
  sku: string
  product_name: string
  status: string
  released_at: string | null
  completed_at: string | null
  qty_completed: string
  qty_scrapped: string
  ideal_cycle_hours: string | null
  qty_planned: string
}

const badgeEstado = (s: string): 'success' | 'warning' | 'neutral' => {
  if (s === 'completed') return 'success'
  if (s === 'released' || s === 'in_progress') return 'warning'
  return 'neutral'
}

/** Piso de planta (modulo 60): OEE real -disponibilidad x rendimiento x calidad-, calculado, no estimado. */
export default async function PisoDePlantaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'shopfloor')

  const { ordenes, paros, sesiones } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const o = await tx<OrdenRow[]>`
      select po.id, p.sku, p.name as product_name, po.status,
             po.released_at::text, po.completed_at::text,
             po.qty_completed::text, po.qty_scrapped::text, po.ideal_cycle_hours::text,
             po.qty_planned::text
      from public.production_orders po
      join public.bill_of_materials bm on bm.id = po.bom_id
      join public.products p on p.id = bm.product_id
      where po.tenant_id = ${ctx.tenantId} and po.status in ('released', 'in_progress', 'completed')
      order by po.released_at desc nulls last
      limit 30`

    const ids = o.map((x) => x.id)
    const d =
      ids.length > 0
        ? await tx<{ production_order_id: string; started_at: string; ended_at: string | null }[]>`
            select production_order_id, started_at::text, ended_at::text
            from public.shopfloor_downtime
            where tenant_id = ${ctx.tenantId} and production_order_id in ${tx(ids)}`
        : []
    const s =
      ids.length > 0
        ? await tx<
            { production_order_id: string; clocked_in_at: string; clocked_out_at: string | null }[]
          >`
            select production_order_id, clocked_in_at::text, clocked_out_at::text
            from public.shopfloor_sessions
            where tenant_id = ${ctx.tenantId} and production_order_id in ${tx(ids)}`
        : []

    return { ordenes: o, paros: d, sesiones: s }
  })

  const qs = ctx.demoQs

  const filas = ordenes.map((o) => {
    // El tiempo que la planta estuvo trabajando esa orden: las sesiones
    // marcadas en la terminal. Sin sesiones, desde que se liberó.
    const sesionesDeOrden = sesiones.filter((s) => s.production_order_id === o.id)
    const inicio = o.released_at ? new Date(o.released_at) : null
    const fin = o.completed_at ? new Date(o.completed_at) : new Date()
    const horasPlanificadas =
      sesionesDeOrden.length > 0
        ? sesionesDeOrden.reduce(
            (a, s) =>
              a +
              Math.max(
                0,
                ((s.clocked_out_at ? new Date(s.clocked_out_at) : new Date()).getTime() -
                  new Date(s.clocked_in_at).getTime()) /
                  3_600_000,
              ),
            0,
          )
        : inicio
          ? Math.max(0, (fin.getTime() - inicio.getTime()) / 3_600_000)
          : 0

    const paroDeOrden = paros
      .filter((p) => p.production_order_id === o.id)
      .map((p) => ({
        startedAt: new Date(p.started_at),
        endedAt: p.ended_at ? new Date(p.ended_at) : null,
      }))
    const horasInactivo = horasInactivoTotal(paroDeOrden)
    const horasOperando = Math.max(0, horasPlanificadas - horasInactivo)

    const disp = disponibilidad(horasPlanificadas, horasInactivo)
    const rend = o.ideal_cycle_hours
      ? rendimiento(
          Number(o.qty_completed) + Number(o.qty_scrapped),
          horasOperando,
          Number(o.ideal_cycle_hours),
        )
      : null
    const cal = calidadOee(Number(o.qty_scrapped), Number(o.qty_completed))
    const oee = rend !== null ? calcularOee(disp, rend, cal) : null

    return { ...o, oee, horasPlanificadas, horasInactivo }
  })

  const promedioOee =
    filas.filter((f) => f.oee !== null).length > 0
      ? filas.reduce((s, f) => s + (f.oee ?? 0), 0) / filas.filter((f) => f.oee !== null).length
      : null

  return (
    <Shell {...shell} activePath="/piso-de-planta">
      <div className="space-y-5">
        <PageHeader
          icon="precision_manufacturing"
          title="Piso de planta"
          description="Cómo va cada orden en la planta. La eficiencia (OEE) multiplica tres cosas: el tiempo que se trabajó sin paros, lo rápido que se produjo contra el ritmo ideal y lo que salió bueno. Se calcula con las entradas, salidas y paros marcados en la terminal."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Órdenes activas"
            value={String(ordenes.filter((o) => o.status !== 'completed').length)}
            hint="liberadas o en progreso"
          />
          <StatCard
            label="Eficiencia (OEE)"
            value={promedioOee === null ? '—' : `${(promedioOee * 100).toFixed(0)}%`}
            hint="promedio; 85 % es de primera"
          />
          <StatCard
            label="Horas de paro"
            value={filas
              .reduce((a, f) => a + f.horasInactivo, 0)
              .toLocaleString('es-DO', { maximumFractionDigits: 1 })}
            hint="en estas órdenes"
          />
        </section>

        {ordenes.length === 0 ? (
          <EmptyState
            icon="precision_manufacturing"
            title="No hay ninguna orden liberada"
            description="Libera una orden en Órdenes de producción para verla aquí."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Orden</TH>
                <TH>Estado</TH>
                <TH numeric>Avance</TH>
                <TH numeric>Horas trabajadas</TH>
                <TH numeric>Eficiencia (OEE)</TH>
              </TR>
            </THead>
            <TBody>
              {filas.map((o) => (
                <TR key={o.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a
                      href={`/piso-de-planta/${o.id}${qs}`}
                      className="underline-offset-2 hover:underline"
                    >
                      <Mono>{o.sku}</Mono> {o.product_name}
                    </a>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(o.status)}>
                      {ESTADO_ORDEN_TERMINAL[o.status] ?? o.status}
                    </Badge>
                  </TD>
                  <TD numeric>
                    <span className="tabular">
                      {Number(o.qty_completed).toLocaleString('es-DO')} de{' '}
                      {Number(o.qty_planned).toLocaleString('es-DO')}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">
                      {o.horasPlanificadas.toLocaleString('es-DO', { maximumFractionDigits: 1 })} h
                    </span>
                  </TD>
                  <TD numeric>
                    {o.oee === null ? (
                      <span className="text-[var(--color-text-muted)]">Falta el ritmo ideal</span>
                    ) : (
                      <span className="tabular font-semibold">{(o.oee * 100).toFixed(0)}%</span>
                    )}
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
