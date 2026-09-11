import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  PageHeader,
  StatCard,
} from '@regb/ui'
import { calcularOee, calidadOee, disponibilidad, horasInactivoTotal, rendimiento } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  fijarCicloIdealForm,
  iniciarParoForm,
  marcarEntradaForm,
  marcarSalidaForm,
  terminarParoForm,
} from '../actions'
import { ESTADO_ORDEN_TERMINAL } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface OrdenHead {
  id: string
  sku: string
  product_name: string
  status: string
  released_at: string | null
  completed_at: string | null
  qty_planned: string
  qty_completed: string
  qty_scrapped: string
  ideal_cycle_hours: string | null
}

interface SesionAbierta {
  id: string
  clocked_in_at: string
}

interface ParoAbierto {
  id: string
  reason: string
  started_at: string
}

const claseInput =
  'h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'
const botonGrande =
  'flex h-14 flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-base font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonGrandeDanger =
  'flex h-14 flex-1 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-semantic-danger)] px-4 text-base font-semibold text-white hover:opacity-90'
const fecha = (iso: string) => new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })

/** Terminal tactil de piso de planta (modulo 60): marcar entrada/salida, paros, y el OEE en vivo. */
export default async function TerminalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'shopfloor', 'shopfloor.operate')

  const { head, sesionAbierta, paroAbierto, paros } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<OrdenHead[]>`
      select po.id, p.sku, p.name as product_name, po.status, po.released_at::text, po.completed_at::text,
             po.qty_planned::text, po.qty_completed::text, po.qty_scrapped::text, po.ideal_cycle_hours::text
      from public.production_orders po
      join public.bill_of_materials bm on bm.id = po.bom_id
      join public.products p on p.id = bm.product_id
      where po.id = ${id} and po.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, sesionAbierta: null, paroAbierto: null, paros: [] }

    const [s] = await tx<SesionAbierta[]>`
      select id, clocked_in_at::text from public.shopfloor_sessions
      where production_order_id = ${id} and tenant_id = ${ctx.tenantId} and clocked_out_at is null
      order by clocked_in_at desc limit 1`

    const [pAbierto] = await tx<ParoAbierto[]>`
      select id, reason, started_at::text from public.shopfloor_downtime
      where production_order_id = ${id} and tenant_id = ${ctx.tenantId} and ended_at is null
      order by started_at desc limit 1`

    const p = await tx<{ started_at: string; ended_at: string | null }[]>`
      select started_at::text, ended_at::text from public.shopfloor_downtime
      where production_order_id = ${id} and tenant_id = ${ctx.tenantId}`

    return { head: h, sesionAbierta: s ?? null, paroAbierto: pAbierto ?? null, paros: p }
  })

  if (!head) notFound()

  const puedeOperar = exigir(ctx, 'shopfloor', 'shopfloor.operate').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="ordenId" value={head.id} />
    </>
  )

  const inicio = head.released_at ? new Date(head.released_at) : null
  const fin = head.completed_at ? new Date(head.completed_at) : new Date()
  const horasPlanificadas = inicio ? Math.max(0, (fin.getTime() - inicio.getTime()) / 3_600_000) : 0
  const horasInactivo = horasInactivoTotal(
    paros.map((p) => ({ startedAt: new Date(p.started_at), endedAt: p.ended_at ? new Date(p.ended_at) : null })),
  )
  const horasOperando = Math.max(0, horasPlanificadas - horasInactivo)
  const disp = disponibilidad(horasPlanificadas, horasInactivo)
  const rend = head.ideal_cycle_hours
    ? rendimiento(Number(head.qty_completed) + Number(head.qty_scrapped), horasOperando, Number(head.ideal_cycle_hours))
    : null
  const cal = calidadOee(Number(head.qty_scrapped), Number(head.qty_completed))
  const oee = rend !== null ? calcularOee(disp, rend, cal) : null

  return (
    <Shell {...shell} activePath="/piso-de-planta">
      <div className="space-y-5">
        <PageHeader
          icon="precision_manufacturing"
          title={`${head.sku} · ${head.product_name}`}
          crumbs={[{ label: 'Piso de planta', href: `/piso-de-planta${qs}` }, { label: 'Terminal' }]}
          actions={<Badge tone="neutral">{ESTADO_ORDEN_TERMINAL[head.status] ?? head.status}</Badge>}
        />

        <section aria-label="OEE" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Disponibilidad" value={`${(disp * 100).toFixed(0)}%`} />
          <StatCard label="Rendimiento" value={rend === null ? '—' : `${(rend * 100).toFixed(0)}%`} />
          <StatCard label="Calidad" value={`${(cal * 100).toFixed(0)}%`} />
          <StatCard label="OEE" value={oee === null ? '—' : `${(oee * 100).toFixed(0)}%`} />
        </section>

        {!head.ideal_cycle_hours && puedeOperar && (
          <Card>
            <CardHeader>
              <CardTitle>Declarar el ciclo ideal</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                Horas ideales para producir UNA unidad -sin esto, el rendimiento no se puede calcular-.
              </p>
              <form action={fijarCicloIdealForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Horas por unidad
                  <input name="idealCycleHours" required inputMode="decimal" className={`tabular ${claseInput}`} />
                </label>
                <BotonEnvio  className="flex h-11 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="check_circle" size={16} />
                  Guardar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeOperar && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Marcaje de tiempo</CardTitle>
              </CardHeader>
              <CardBody>
                {sesionAbierta ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--color-text-muted)]">
                      Entrada marcada: <strong>{fecha(sesionAbierta.clocked_in_at)}</strong>
                    </p>
                    <form action={marcarSalidaForm}>
                      {campos}
                      <input type="hidden" name="sesionId" value={sesionAbierta.id} />
                      <BotonEnvio  className={botonGrandeDanger}>
                        <Icon name="logout" size={20} />
                        Marcar salida
                      </BotonEnvio>
                    </form>
                  </div>
                ) : (
                  <form action={marcarEntradaForm}>
                    {campos}
                    <BotonEnvio  className={botonGrande}>
                      <Icon name="login" size={20} />
                      Marcar entrada
                    </BotonEnvio>
                  </form>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Paro de la orden</CardTitle>
              </CardHeader>
              <CardBody>
                {paroAbierto ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--color-text-muted)]">
                      Parado desde <strong>{fecha(paroAbierto.started_at)}</strong> — {paroAbierto.reason}
                    </p>
                    <form action={terminarParoForm}>
                      {campos}
                      <input type="hidden" name="paroId" value={paroAbierto.id} />
                      <BotonEnvio  className={botonGrande}>
                        <Icon name="play_arrow" size={20} />
                        Terminar paro
                      </BotonEnvio>
                    </form>
                  </div>
                ) : (
                  <form action={iniciarParoForm} className="space-y-3">
                    {campos}
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Razon del paro
                      <input name="reason" required className={claseInput} />
                    </label>
                    <BotonEnvio  className={botonGrandeDanger}>
                      <Icon name="pause" size={20} />
                      Iniciar paro
                    </BotonEnvio>
                  </form>
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </Shell>
  )
}
