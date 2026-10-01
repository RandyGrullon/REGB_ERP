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
import { loteProximoAVencer, loteVigente } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { abrirRecallForm, cerrarRecallForm, consumirFefoForm, registrarLoteForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { cantidad } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Lotes y series · REGB ERP' }

interface ProductoOption {
  id: string
  sku: string
  name: string
}

interface AlmacenOption {
  id: string
  name: string
}

interface LoteRow {
  id: string
  product_id: string
  product_name: string
  unit: string
  lot_number: string
  expiry_date: string | null
  qty_total: string
  almacenes: string | null
}

interface RecallRow {
  id: string
  lot_id: string | null
  product_name: string
  lot_number: string | null
  reason: string
  status: string
  created_at: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

/** Lotes, series y vencimientos (modulo 49): FEFO real, no una tabla que alguien revisa a mano. */
export default async function LotesPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'lots-serials')

  const { productos, almacenes, lotes, recalls } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const p = await tx<ProductoOption[]>`
        select id, sku, name from public.products
        -- Un servicio (envio, instalacion) no tiene lotes ni existencias:
        -- ofrecerlo aqui terminaba en el error del kardex al registrar.
        where tenant_id = ${ctx.tenantId} and active and tracks_stock order by name limit 300`
      const a = await tx<AlmacenOption[]>`
        select id, name from public.warehouses
        where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
      const l = await tx<LoteRow[]>`
        select pl.id, pl.product_id, pr.name as product_name, pr.unit, pl.lot_number,
               pl.expiry_date::text,
               coalesce((select sum(ls.qty_on_hand) from public.lot_stock ls where ls.lot_id = pl.id), 0)::text
                 as qty_total,
               (select string_agg(w.name, ', ' order by w.name)
                  from public.lot_stock ls join public.warehouses w on w.id = ls.warehouse_id
                 where ls.lot_id = pl.id and ls.qty_on_hand > 0) as almacenes
        from public.product_lots pl
        join public.products pr on pr.id = pl.product_id
        where pl.tenant_id = ${ctx.tenantId}
        order by pl.expiry_date nulls last, pr.name`
      const r = await tx<RecallRow[]>`
        select rc.id, rc.lot_id, pr.name as product_name, pl.lot_number, rc.reason, rc.status, rc.created_at::text
        from public.product_recalls rc
        join public.products pr on pr.id = rc.product_id
        left join public.product_lots pl on pl.id = rc.lot_id
        where rc.tenant_id = ${ctx.tenantId}
        order by rc.created_at desc`
      return { productos: p, almacenes: a, lotes: l, recalls: r }
    },
  )

  const ahora = new Date()
  const porVencer = lotes.filter(
    (l) => l.expiry_date && loteProximoAVencer(new Date(l.expiry_date), ahora),
  ).length
  const vencidos = lotes.filter(
    (l) => l.expiry_date && !loteVigente(new Date(l.expiry_date), ahora),
  ).length
  const recallsAbiertos = recalls.filter((r) => r.status === 'open').length
  const lotesEnRetiro = new Set(
    recalls.filter((r) => r.status === 'open' && r.lot_id).map((r) => r.lot_id),
  )

  const puedeGestionar = exigir(ctx, 'lots-serials', 'lots-serials.manage').ok
  const puedeRecall = exigir(ctx, 'lots-serials', 'lots-serials.recall').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

  // Fecha sin hora: se pinta en UTC para que el 9 de septiembre no salga 8.
  const dia = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })

  const badgeVencimiento = (fecha: string | null) => {
    if (!fecha) return null
    const d = new Date(fecha)
    if (!loteVigente(d, ahora)) return <Badge tone="danger">Vencido</Badge>
    if (loteProximoAVencer(d, ahora)) return <Badge tone="warning">Por vencer</Badge>
    return null
  }

  return (
    <Shell {...shell} activePath="/lotes">
      <div className="space-y-5">
        <PageHeader
          icon="qr_code_2"
          title="Lotes y series"
          description="Cada lote con su vencimiento. Al sacar mercancía el sistema elige primero el lote que vence más pronto, no el que quede más a mano."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Lotes registrados" value={String(lotes.length)} />
          <StatCard label="Por vencer" value={String(porVencer)} hint="en los próximos días" />
          <StatCard label="Vencidos" value={String(vencidos)} hint="sacarlos del estante" />
          <StatCard
            label="Retiros abiertos"
            value={String(recallsAbiertos)}
            hint="lotes bloqueados"
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Lotes registrados</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {lotes.length === 0 ? (
              <EmptyState
                icon="qr_code_2"
                title="Todavía no hay ningún lote"
                description="Registra el lote de lo que llega con fecha de vencimiento (pinturas, químicos, alimentos) y el sistema te avisa antes de que se venza."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH>Lote / serie</TH>
                    <TH>Vencimiento</TH>
                    <TH>Dónde está</TH>
                    <TH numeric>Existencia</TH>
                    {puedeRecall && (
                      <TH>
                        <span className="sr-only">Acción</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {lotes.map((l) => (
                    <TR key={l.id}>
                      <TD className="text-[var(--color-text-primary)]">{l.product_name}</TD>
                      <TD className="whitespace-nowrap">
                        <Mono>{l.lot_number}</Mono>
                      </TD>
                      <TD className="whitespace-nowrap">
                        {l.expiry_date ? dia(l.expiry_date) : 'No vence'}{' '}
                        {badgeVencimiento(l.expiry_date)}
                      </TD>
                      <TD>{l.almacenes ?? 'Agotado'}</TD>
                      <TD numeric>
                        <span className="tabular">{cantidad(l.qty_total, l.unit)}</span>
                      </TD>
                      {puedeRecall && (
                        <TD>
                          {lotesEnRetiro.has(l.id) ? (
                            <Badge tone="danger">En retiro</Badge>
                          ) : (
                            <form
                              action={abrirRecallForm}
                              className="flex flex-wrap items-center gap-1"
                            >
                              {campos}
                              <input type="hidden" name="productId" value={l.product_id} />
                              <input type="hidden" name="lotId" value={l.id} />
                              <input
                                name="reason"
                                placeholder="Por qué se retira"
                                aria-label={`Por qué se retira el lote ${l.lot_number} de ${l.product_name}`}
                                className="h-8 w-36 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                              />
                              <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                                Retirar
                              </BotonEnvio>
                            </form>
                          )}
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retiros de mercancía</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {recalls.length === 0 ? (
              <EmptyState
                icon="report"
                title="Ningún lote retirado"
                description="Si un lote sale malo o el fabricante lo retira, márcalo con Retirar en la tabla de lotes: queda bloqueado y con su razón para cualquier reclamo."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH>Lote</TH>
                    <TH>Razón</TH>
                    <TH>Desde</TH>
                    <TH>Estado</TH>
                    {puedeRecall && (
                      <TH>
                        <span className="sr-only">Acción</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {recalls.map((r) => (
                    <TR key={r.id}>
                      <TD className="text-[var(--color-text-primary)]">{r.product_name}</TD>
                      <TD>{r.lot_number ?? 'Todo el producto'}</TD>
                      <TD className="max-w-72">
                        <span className="line-clamp-2" title={r.reason}>
                          {r.reason}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap">{dia(r.created_at)}</TD>
                      <TD>
                        <Badge tone={r.status === 'open' ? 'danger' : 'neutral'}>
                          {r.status === 'open' ? 'Retirado' : 'Cerrado'}
                        </Badge>
                      </TD>
                      {puedeRecall && r.status === 'open' && (
                        <TD>
                          <form action={cerrarRecallForm}>
                            {campos}
                            <input type="hidden" name="recallId" value={r.id} />
                            <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                              Cerrar
                            </BotonEnvio>
                          </form>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {puedeGestionar && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Registrar lote</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={registrarLoteForm} className="flex flex-wrap items-end gap-3">
                  {campos}
                  <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Producto
                    <select name="productId" required className={claseInput}>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Almacén
                    <select name="warehouseId" required className={claseInput}>
                      {almacenes.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Número de lote/serie
                    <input name="lotNumber" required className={claseInput} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Vencimiento
                    <input type="date" name="expiryDate" className={claseInput} />
                  </label>
                  <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Cantidad
                    <input
                      name="qty"
                      required
                      inputMode="decimal"
                      className={`tabular ${claseInput}`}
                    />
                  </label>
                  <label className="flex min-w-48 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    De dónde sale
                    {/* Lo que llego por Recepciones YA esta en el inventario:
                        registrar su lote como entrada lo contaba dos veces. */}
                    <select name="origen" defaultValue="existente" className={claseInput}>
                      <option value="existente">
                        Ya está en el almacén (llegó por una recepción)
                      </option>
                      <option value="entrada">Entra ahora al inventario</option>
                    </select>
                  </label>
                  <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Costo unitario
                    <input
                      name="unitCost"
                      inputMode="decimal"
                      placeholder="solo si entra"
                      className={`tabular ${claseInput}`}
                    />
                  </label>
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="add" size={14} />
                    Registrar
                  </BotonEnvio>
                </form>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sacar mercancía (sale primero lo que vence antes)</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={consumirFefoForm} className="flex flex-wrap items-end gap-3">
                  {campos}
                  <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Producto
                    <select name="productId" required className={claseInput}>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Almacén
                    <select name="warehouseId" required className={claseInput}>
                      {almacenes.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Cantidad
                    <input
                      name="qty"
                      required
                      inputMode="decimal"
                      className={`tabular ${claseInput}`}
                    />
                  </label>
                  <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Razón
                    <input name="notes" placeholder="Venta, merma, etc." className={claseInput} />
                  </label>
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="output" size={14} />
                    Consumir
                  </BotonEnvio>
                </form>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  El sistema elige solo de qué lote sacar cada unidad: el que vence más pronto
                  primero. Úsalo para mermas, muestras y salidas que no pasan por la caja.
                </p>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </Shell>
  )
}
