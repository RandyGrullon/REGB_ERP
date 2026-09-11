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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { correrMrpForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Planificacion MRP · REGB ERP' }

interface CorridaRow {
  id: string
  run_at: string
  notes: string | null
  sku: string
  producto_terminado: string
  target_qty: string
  pendientes: string
  total: string
}

interface ProductoOption {
  id: string
  sku: string
  name: string
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Planificacion MRP (modulo 57): explosion de necesidades real
 * -multinivel, la misma materia prima se suma entre recetas
 * distintas- y sugerencias de comprar o producir que nunca se
 * ejecutan solas.
 */
export default async function MrpPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'mrp')

  const { corridas, productos, pendientesTotal } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<CorridaRow[]>`
      select r.id, r.run_at::text, r.notes, p.sku, p.name as producto_terminado,
             r.target_qty::text,
             (select count(*) from public.mrp_suggestions s
                where s.run_id = r.id and s.status = 'pending')::text as pendientes,
             (select count(*) from public.mrp_suggestions s where s.run_id = r.id)::text as total
      from public.mrp_runs r
      join public.products p on p.id = r.target_product_id
      where r.tenant_id = ${ctx.tenantId}
      order by r.run_at desc
      limit 50`
    const p = await tx<ProductoOption[]>`
      select bm.product_id as id, pr.sku, pr.name
      from public.bill_of_materials bm
      join public.products pr on pr.id = bm.product_id
      where bm.tenant_id = ${ctx.tenantId} and bm.status = 'active'
      order by pr.name`
    const [t] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.mrp_suggestions
      where tenant_id = ${ctx.tenantId} and status = 'pending'`
    return { corridas: c, productos: p, pendientesTotal: Number(t?.n ?? 0) }
  })

  const puedeCorrer = exigir(ctx, 'mrp', 'mrp.run').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/mrp">
      <div className="space-y-5">
        <PageHeader
          icon="insights"
          title="Planificacion MRP"
          description="Explota el BOM completo -si un componente se produce, tambien explota SUS componentes- y suma la misma materia prima entre recetas distintas antes de sugerir que comprar o producir."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Sugerencias pendientes" value={String(pendientesTotal)} />
          <StatCard label="Corridas" value={String(corridas.length)} />
        </section>

        {puedeCorrer && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva corrida</CardTitle>
            </CardHeader>
            <CardBody>
              {productos.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Todavia no hay ningun BOM activo -activa uno primero en Lista de materiales-.
                </p>
              ) : (
                <form action={correrMrpForm} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Producto terminado
                    <select
                      name="productId"
                      required
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    >
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Cantidad a producir
                    <input
                      name="targetQty"
                      defaultValue="1"
                      inputMode="decimal"
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                    />
                  </label>
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Nota (opcional)
                    <input
                      name="notes"
                      className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    />
                  </label>
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="bolt" size={14} />
                    Correr MRP
                  </BotonEnvio>
                </form>
              )}
            </CardBody>
          </Card>
        )}

        {corridas.length === 0 ? (
          <EmptyState
            icon="insights"
            title="Todavia no has corrido MRP"
            description="Elige un producto con BOM activo arriba y corre la primera explosion de necesidades."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Producto objetivo</TH>
                <TH numeric>Cantidad</TH>
                <TH>Corrida</TH>
                <TH numeric>Sugerencias</TH>
                <TH numeric>Pendientes</TH>
              </TR>
            </THead>
            <TBody>
              {corridas.map((c) => (
                <TR key={c.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/mrp/${c.id}${qs}`} className="underline-offset-2 hover:underline">
                      <Mono>{c.sku}</Mono> {c.producto_terminado}
                    </a>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{c.target_qty}</span>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">
                    {fecha(c.run_at)}
                    {c.notes && <span className="ml-1.5">· {c.notes}</span>}
                  </TD>
                  <TD numeric>
                    <span className="tabular">{c.total}</span>
                  </TD>
                  <TD numeric>
                    {Number(c.pendientes) > 0 ? (
                      <Badge tone="warning">{c.pendientes}</Badge>
                    ) : (
                      <span className="tabular text-[var(--color-text-muted)]">0</span>
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
