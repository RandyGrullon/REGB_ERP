import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import {
  calcularOee,
  calidadOee,
  disponibilidad,
  horasInactivoTotal,
  rendimiento,
} from '@regb/operations'
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
  'flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--color-brand)] px-4 text-base font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonGrandeDanger =
  'flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--color-semantic-danger)] px-4 text-base font-semibold text-white hover:opacity-90'
const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
const horas = (desde: string, hasta: string | null) =>
  Math.max(
    0,
    ((hasta ? new Date(hasta) : new Date()).getTime() - new Date(desde).getTime()) / 3_600_000,
  )

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

  const { head, sesionAbierta, paroAbierto, paros, sesiones } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [h] = await tx<OrdenHead[]>`
      select po.id, p.sku, p.name as product_name, po.status, po.released_at::text, po.completed_at::text,
             po.qty_planned::text, po.qty_completed::text, po.qty_scrapped::text, po.ideal_cycle_hours::text
      from public.production_orders po
      join public.bill_of_materials bm on bm.id = po.bom_id
      join public.products p on p.id = bm.product_id
      where po.id = ${id} and po.tenant_id = ${ctx.tenantId}`
      if (!h) return { head: null, sesionAbierta: null, paroAbierto: null, paros: [], sesiones: [] }

      const [s] = await tx<SesionAbierta[]>`
      select id, clocked_in_at::text from public.shopfloor_sessions
      where production_order_id = ${id} and tenant_id = ${ctx.tenantId} and clocked_out_at is null
      order by clocked_in_at desc limit 1`

      const [pAbierto] = await tx<ParoAbierto[]>`
      select id, reason, started_at::text from public.shopfloor_downtime
      where production_order_id = ${id} and tenant_id = ${ctx.tenantId} and ended_at is null
      order by started_at desc limit 1`

      const p = await tx<
        { id: string; reason: string; started_at: string; ended_at: string | null }[]
      >`
      select id, reason, started_at::text, ended_at::text from public.shopfloor_downtime
      where production_order_id = ${id} and tenant_id = ${ctx.tenantId}
      order by started_at desc`

      const ss = await tx<
        { id: string; clocked_in_at: string; clocked_out_at: string | null; quien: string | null }[]
      >`
      select s.id, s.clocked_in_at::text, s.clocked_out_at::text, up.display_name as quien
      from public.shopfloor_sessions s
      left join public.user_profiles up
        on up.tenant_id = s.tenant_id and up.user_id = s.operator_id
      where s.production_order_id = ${id} and s.tenant_id = ${ctx.tenantId}
      order by s.clocked_in_at desc`

      return {
        head: h,
        sesionAbierta: s ?? null,
        paroAbierto: pAbierto ?? null,
        paros: p,
        sesiones: ss,
      }
    },
  )

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

  // El tiempo trabajado son las sesiones marcadas en esta terminal; si
  // nadie ha marcado todavía, desde que se liberó la orden.
  const inicio = head.released_at ? new Date(head.released_at) : null
  const fin = head.completed_at ? new Date(head.completed_at) : new Date()
  const horasPlanificadas =
    sesiones.length > 0
      ? sesiones.reduce((a, s) => a + horas(s.clocked_in_at, s.clocked_out_at), 0)
      : inicio
        ? Math.max(0, (fin.getTime() - inicio.getTime()) / 3_600_000)
        : 0
  const horasInactivo = horasInactivoTotal(
    paros.map((p) => ({
      startedAt: new Date(p.started_at),
      endedAt: p.ended_at ? new Date(p.ended_at) : null,
    })),
  )
  const horasOperando = Math.max(0, horasPlanificadas - horasInactivo)
  const disp = disponibilidad(horasPlanificadas, horasInactivo)
  const rend = head.ideal_cycle_hours
    ? rendimiento(
        Number(head.qty_completed) + Number(head.qty_scrapped),
        horasOperando,
        Number(head.ideal_cycle_hours),
      )
    : null
  const cal = calidadOee(Number(head.qty_scrapped), Number(head.qty_completed))
  const oee = rend !== null ? calcularOee(disp, rend, cal) : null

  return (
    <Shell {...shell} activePath="/piso-de-planta">
      <div className="space-y-5">
        <PageHeader
          icon="precision_manufacturing"
          title={`${head.sku} · ${head.product_name}`}
          description={`Van ${Number(head.qty_completed).toLocaleString('es-DO')} de ${Number(head.qty_planned).toLocaleString('es-DO')} buenas y ${Number(head.qty_scrapped).toLocaleString('es-DO')} en merma, en ${horasPlanificadas.toLocaleString('es-DO', { maximumFractionDigits: 1 })} h trabajadas.`}
          crumbs={[
            { label: 'Piso de planta', href: `/piso-de-planta${qs}` },
            { label: 'Terminal' },
          ]}
          actions={
            <Badge tone="neutral">{ESTADO_ORDEN_TERMINAL[head.status] ?? head.status}</Badge>
          }
        />

        <section aria-label="OEE" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Disponibilidad"
            value={`${(disp * 100).toFixed(0)}%`}
            hint="tiempo trabajado sin paros"
          />
          <StatCard
            label="Rendimiento"
            value={rend === null ? '—' : `${(rend * 100).toFixed(0)}%`}
            hint="contra el ritmo ideal"
          />
          <StatCard
            label="Calidad"
            value={`${(cal * 100).toFixed(0)}%`}
            hint="lo que salió bueno"
          />
          <StatCard
            label="Eficiencia (OEE)"
            value={oee === null ? '—' : `${(oee * 100).toFixed(0)}%`}
            hint="las tres multiplicadas"
          />
        </section>

        {!head.ideal_cycle_hours && puedeOperar && (
          <Card>
            <CardHeader>
              <CardTitle>Declarar el ciclo ideal</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                Cuántas horas debería tomar producir una unidad a buen ritmo. Sin esto no se puede
                calcular el rendimiento.
              </p>
              <form action={fijarCicloIdealForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Horas por unidad
                  <input
                    name="idealCycleHours"
                    required
                    inputMode="decimal"
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <BotonEnvio className="flex h-11 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
                      <BotonEnvio className={botonGrandeDanger}>
                        <Icon name="logout" size={20} />
                        Marcar salida
                      </BotonEnvio>
                    </form>
                  </div>
                ) : (
                  <form action={marcarEntradaForm}>
                    {campos}
                    <BotonEnvio className={botonGrande}>
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
                      Parado desde <strong>{fecha(paroAbierto.started_at)}</strong> —{' '}
                      {paroAbierto.reason}
                    </p>
                    <form action={terminarParoForm}>
                      {campos}
                      <input type="hidden" name="paroId" value={paroAbierto.id} />
                      <BotonEnvio className={botonGrande}>
                        <Icon name="play_arrow" size={20} />
                        Terminar paro
                      </BotonEnvio>
                    </form>
                  </div>
                ) : (
                  <form action={iniciarParoForm} className="space-y-3">
                    {campos}
                    <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Razón del paro
                      <input name="reason" required className={claseInput} />
                    </label>
                    <BotonEnvio className={botonGrandeDanger}>
                      <Icon name="pause" size={20} />
                      Iniciar paro
                    </BotonEnvio>
                  </form>
                )}
              </CardBody>
            </Card>
          </div>
        )}

        {(sesiones.length > 0 || paros.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Turnos marcados</CardTitle>
              </CardHeader>
              <CardBody>
                {sesiones.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Nadie ha marcado entrada en esta orden.
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {sesiones.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <span className="text-[var(--color-text-primary)]">
                          {s.quien ?? 'Operario'}
                          <span className="block text-xs text-[var(--color-text-muted)]">
                            {fecha(s.clocked_in_at)}
                          </span>
                        </span>
                        <span className="tabular text-[var(--color-text-secondary)]">
                          {s.clocked_out_at
                            ? `${horas(s.clocked_in_at, s.clocked_out_at).toLocaleString('es-DO', { maximumFractionDigits: 1 })} h`
                            : 'Trabajando'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Paros</CardTitle>
              </CardHeader>
              <CardBody>
                {paros.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Esta orden no ha tenido paros.
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border)]">
                    {paros.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 py-2 text-sm"
                      >
                        <span className="text-[var(--color-text-primary)]">
                          {p.reason}
                          <span className="block text-xs text-[var(--color-text-muted)]">
                            {fecha(p.started_at)}
                          </span>
                        </span>
                        <span className="tabular text-[var(--color-text-secondary)]">
                          {p.ended_at
                            ? `${horas(p.started_at, p.ended_at).toLocaleString('es-DO', { maximumFractionDigits: 1 })} h`
                            : 'Parado'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </Shell>
  )
}
