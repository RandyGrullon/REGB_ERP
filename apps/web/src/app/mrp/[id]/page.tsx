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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { aceptarSugerenciaForm, descartarSugerenciaForm } from '../actions'
import { ACCION_SUGERENCIA, ESTADO_SUGERENCIA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'
import { cantidad, unirFrases } from '@/lib/cantidad'
import { explotarNecesidadesMrp } from '@regb/operations'
import { resolverNodoMrp } from '../explosion'

export const dynamic = 'force-dynamic'

interface CorridaHead {
  id: string
  target_product_id: string
  run_at: string
  notes: string | null
  sku: string
  producto_terminado: string
  unit: string
  target_qty: string
  quien: string | null
}

interface SugerenciaRow {
  id: string
  product_id: string
  sku: string
  name: string
  unit: string
  existencia: string
  action: string
  qty_suggested: string
  status: string
  production_order_id: string | null
}

interface AlmacenOption {
  id: string
  name: string
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
const badgeEstado = (estado: string): 'success' | 'warning' | 'neutral' => {
  if (estado === 'accepted') return 'success'
  if (estado === 'pending') return 'warning'
  return 'neutral'
}

/** Detalle de una corrida de MRP: sus sugerencias, aceptar (producir/comprar) o descartar. */
export default async function MrpDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'mrp')

  const { head, sugerencias, almacenes, brutas } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [h] = await tx<CorridaHead[]>`
      select r.id, r.target_product_id, r.run_at::text, r.notes, p.sku, p.name as producto_terminado, p.unit,
             r.target_qty::text, up.display_name as quien
      from public.mrp_runs r
      join public.products p on p.id = r.target_product_id
      left join public.user_profiles up on up.tenant_id = r.tenant_id and up.user_id = r.created_by
      where r.id = ${id} and r.tenant_id = ${ctx.tenantId}`
      if (!h)
        return { head: null, sugerencias: [], almacenes: [], brutas: new Map<string, number>() }

      const s = await tx<SugerenciaRow[]>`
      select s.id, s.product_id, p.sku, p.name, p.unit,
             coalesce((select sum(sl.qty_on_hand) from public.stock_levels sl
                        where sl.product_id = p.id and sl.tenant_id = s.tenant_id), 0)::text
               as existencia,
             s.action, s.qty_suggested::text, s.status, s.production_order_id
      from public.mrp_suggestions s
      join public.products p on p.id = s.product_id
      where s.run_id = ${id} and s.tenant_id = ${ctx.tenantId}
      order by p.name`

      const a = await tx<AlmacenOption[]>`
      select id, name from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`

      // Cuánto pide la receta en total para esa cantidad, con la receta de
      // hoy. Lo sugerido se calculó al planificar, restando lo que había ese
      // día; sin el total, "hay 540 y faltan 20" no se entiende.
      const nodo = await resolverNodoMrp(
        tx,
        ctx.tenantId,
        h.target_product_id,
        Number(h.target_qty),
        0,
        true,
      )
      const brutas = new Map(
        explotarNecesidadesMrp(nodo.subComponentes ?? []).map((n) => [
          n.productId,
          n.cantidadBruta,
        ]),
      )

      return { head: h, sugerencias: s, almacenes: a, brutas }
    },
  )

  if (!head) notFound()

  const puedeResolver = exigir(ctx, 'mrp', 'mrp.resolve').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )
  const pendientes = sugerencias.filter((s) => s.status === 'pending').length

  return (
    <Shell {...shell} activePath="/mrp">
      <div className="space-y-5">
        <PageHeader
          icon="insights"
          title={`${head.producto_terminado}: ${cantidad(head.target_qty)} por fabricar`}
          description={unirFrases([
            `Planificado el ${fecha(head.run_at)}${head.quien ? ` por ${head.quien}` : ''}`,
            'Lo sugerido se calculó ese día, restando lo que había en existencia.',
          ])}
          crumbs={[
            { label: 'Planificación de materiales', href: `/mrp${qs}` },
            { label: head.sku },
          ]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Sugerencias" value={String(sugerencias.length)} />
          <StatCard label="Pendientes" value={String(pendientes)} hint="por aceptar o descartar" />
          <StatCard
            label="Para comprar"
            value={String(sugerencias.filter((s) => s.action === 'purchase').length)}
            hint="materia prima"
          />
        </section>

        {head.notes && (
          <p className="text-xs text-[var(--color-text-muted)]">
            <Icon name="sticky_note_2" size={12} /> {head.notes}
          </p>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Componente</TH>
              <TH>Acción</TH>
              <TH numeric>Se necesita</TH>
              <TH numeric>Hay ahora</TH>
              <TH numeric>Sugerido</TH>
              <TH>Estado</TH>
              {puedeResolver && (
                <TH>
                  <span className="sr-only">Resolver</span>
                </TH>
              )}
            </TR>
          </THead>
          <TBody>
            {sugerencias.map((s) => (
              <TR key={s.id}>
                <TD className="text-[var(--color-text-primary)]">
                  <Mono>{s.sku}</Mono> {s.name}
                </TD>
                <TD>
                  <Badge tone={s.action === 'produce' ? 'info' : 'neutral'}>
                    {ACCION_SUGERENCIA[s.action] ?? s.action}
                  </Badge>
                </TD>
                <TD numeric>
                  <span className="tabular whitespace-nowrap">
                    {brutas.has(s.product_id) ? cantidad(brutas.get(s.product_id), s.unit) : '—'}
                  </span>
                </TD>
                <TD numeric>
                  <span className="tabular whitespace-nowrap text-[var(--color-text-muted)]">
                    {cantidad(s.existencia, s.unit)}
                  </span>
                </TD>
                <TD numeric>
                  <span className="tabular whitespace-nowrap font-semibold">
                    {cantidad(s.qty_suggested, s.unit)}
                  </span>
                  {s.status === 'pending' &&
                    Number(s.existencia) >= (brutas.get(s.product_id) ?? Infinity) && (
                      <span className="block text-xs font-normal text-[var(--color-semantic-text-success)]">
                        ya alcanza con lo que hay
                      </span>
                    )}
                </TD>
                <TD>
                  <Badge tone={badgeEstado(s.status)}>
                    {ESTADO_SUGERENCIA[s.status] ?? s.status}
                  </Badge>
                  {s.production_order_id && (
                    <a
                      href={`/produccion/${s.production_order_id}${qs}`}
                      className="ml-2 text-xs text-[var(--color-text-link)] underline-offset-2 hover:underline"
                    >
                      Ver orden
                    </a>
                  )}
                </TD>
                {puedeResolver && (
                  <TD>
                    {s.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        {s.action === 'produce' ? (
                          <form
                            action={aceptarSugerenciaForm}
                            className="flex items-center gap-1.5"
                          >
                            {campos}
                            <input type="hidden" name="suggestionId" value={s.id} />
                            <select
                              name="warehouseId"
                              required
                              aria-label={`Almacén para producir ${s.name}`}
                              className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-1.5 text-xs text-[var(--color-text-primary)]"
                            >
                              {almacenes.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                            <BotonEnvio className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                              <Icon name="check_circle" size={13} />
                              Aceptar
                            </BotonEnvio>
                          </form>
                        ) : (
                          <form action={aceptarSugerenciaForm}>
                            {campos}
                            <input type="hidden" name="suggestionId" value={s.id} />
                            <BotonEnvio className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                              <Icon name="check_circle" size={13} />
                              Aceptar
                            </BotonEnvio>
                          </form>
                        )}
                        <form action={descartarSugerenciaForm}>
                          {campos}
                          <input type="hidden" name="suggestionId" value={s.id} />
                          <BotonEnvio
                            aria-label={`Descartar sugerencia de ${s.name}`}
                            className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]"
                          >
                            <Icon name="close" size={16} />
                          </BotonEnvio>
                        </form>
                      </div>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>

        <Card>
          <CardHeader>
            <CardTitle>Qué pasa al aceptar</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              Aceptar una sugerencia de <strong>producir</strong> crea la orden de producción en
              borrador, en el almacén que elijas, lista para revisar y liberar. Aceptar una de{' '}
              <strong>comprar</strong> la deja anotada como aceptada: la orden de compra se hace en
              Órdenes de compra. Lo sugerido se calculó al planificar, contra lo que había en
              existencia ese día; lo que ya viene en camino de un proveedor no se descuenta. Si
              ahora ya alcanza con lo que hay, descarta la sugerencia.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
