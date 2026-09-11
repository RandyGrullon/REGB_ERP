import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
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
import {
  abrirRecallForm,
  cerrarRecallForm,
  consumirFefoForm,
  registrarLoteForm,
} from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

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
  lot_number: string
  expiry_date: string | null
  qty_total: string
}

interface RecallRow {
  id: string
  product_name: string
  lot_number: string | null
  reason: string
  status: string
  created_at: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

/** Lotes, series y vencimientos (modulo 49): FEFO real, no una tabla que alguien revisa a mano. */
export default async function LotesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'lots-serials')

  const { productos, almacenes, lotes, recalls } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const p = await tx<ProductoOption[]>`
        select id, sku, name from public.products
        where tenant_id = ${ctx.tenantId} and active order by name limit 300`
      const a = await tx<AlmacenOption[]>`
        select id, name from public.warehouses
        where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
      const l = await tx<LoteRow[]>`
        select pl.id, pl.product_id, pr.name as product_name, pl.lot_number, pl.expiry_date::text,
               coalesce((select sum(ls.qty_on_hand) from public.lot_stock ls where ls.lot_id = pl.id), 0)::text
                 as qty_total
        from public.product_lots pl
        join public.products pr on pr.id = pl.product_id
        where pl.tenant_id = ${ctx.tenantId}
        order by pl.expiry_date nulls last, pr.name`
      const r = await tx<RecallRow[]>`
        select rc.id, pr.name as product_name, pl.lot_number, rc.reason, rc.status, rc.created_at::text
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

  const puedeGestionar = exigir(ctx, 'lots-serials', 'lots-serials.manage').ok
  const puedeRecall = exigir(ctx, 'lots-serials', 'lots-serials.recall').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

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
          description="Consumir stock elige el lote por FEFO -el que vence mas pronto primero-, nunca a criterio de quien despacha."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Lotes registrados" value={String(lotes.length)} />
          <StatCard label="Por vencer" value={String(porVencer)} />
          <StatCard label="Vencidos" value={String(vencidos)} />
          <StatCard label="Recalls abiertos" value={String(recallsAbiertos)} />
        </section>

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
                    Almacen
                    <select name="warehouseId" required className={claseInput}>
                      {almacenes.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Numero de lote/serie
                    <input name="lotNumber" required className={claseInput} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Vencimiento
                    <input type="date" name="expiryDate" className={claseInput} />
                  </label>
                  <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Cantidad
                    <input name="qty" required inputMode="decimal" className={`tabular ${claseInput}`} />
                  </label>
                  <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Costo unitario
                    <input name="unitCost" required inputMode="decimal" className={`tabular ${claseInput}`} />
                  </label>
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="add" size={14} />
                    Registrar
                  </BotonEnvio>
                </form>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Consumir stock (FEFO automatico)</CardTitle>
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
                    Almacen
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
                    <input name="qty" required inputMode="decimal" className={`tabular ${claseInput}`} />
                  </label>
                  <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Razon
                    <input name="notes" placeholder="Venta, merma, etc." className={claseInput} />
                  </label>
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                    <Icon name="output" size={14} />
                    Consumir
                  </BotonEnvio>
                </form>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  El sistema elige solo de que lote sacar cada unidad -el que vence mas pronto
                  primero-. No esta conectado al checkout de ventas todavia.
                </p>
              </CardBody>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Lotes registrados</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {lotes.length === 0 ? (
              <EmptyState icon="qr_code_2" title="Todavia no hay ningun lote" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH>Lote / serie</TH>
                    <TH>Vencimiento</TH>
                    <TH numeric>Existencia total</TH>
                    {puedeRecall && (
                      <TH>
                        <span className="sr-only">Accion</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {lotes.map((l) => (
                    <TR key={l.id}>
                      <TD className="text-[var(--color-text-primary)]">{l.product_name}</TD>
                      <TD>{l.lot_number}</TD>
                      <TD>
                        {l.expiry_date ?? '—'} {badgeVencimiento(l.expiry_date)}
                      </TD>
                      <TD numeric>
                        <span className="tabular">{l.qty_total}</span>
                      </TD>
                      {puedeRecall && (
                        <TD>
                          <form action={abrirRecallForm} className="flex flex-wrap items-center gap-1">
                            {campos}
                            <input type="hidden" name="productId" value={l.product_id} />
                            <input type="hidden" name="lotId" value={l.id} />
                            <input
                              name="reason"
                              placeholder="Razon del recall"
                              aria-label={`Razon del recall de ${l.product_name} lote ${l.lot_number}`}
                              className="h-8 w-36 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                            />
                            <BotonEnvio
                              
                              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]">
                              Recall
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

        <Card>
          <CardHeader>
            <CardTitle>Recalls</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {recalls.length === 0 ? (
              <EmptyState icon="report" title="Ningun recall abierto ni cerrado" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH>Lote</TH>
                    <TH>Razon</TH>
                    <TH>Estado</TH>
                    {puedeRecall && (
                      <TH>
                        <span className="sr-only">Accion</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {recalls.map((r) => (
                    <TR key={r.id}>
                      <TD className="text-[var(--color-text-primary)]">{r.product_name}</TD>
                      <TD>{r.lot_number ?? 'Todo el producto'}</TD>
                      <TD className="max-w-56 truncate">{r.reason}</TD>
                      <TD>
                        <Badge tone={r.status === 'open' ? 'danger' : 'neutral'}>
                          {r.status === 'open' ? 'Abierto' : 'Cerrado'}
                        </Badge>
                      </TD>
                      {puedeRecall && r.status === 'open' && (
                        <TD>
                          <form action={cerrarRecallForm}>
                            {campos}
                            <input type="hidden" name="recallId" value={r.id} />
                            <BotonEnvio
                              
                              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
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
      </div>
    </Shell>
  )
}
