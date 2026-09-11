import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
  StatCard,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { BarraEscritorio } from '@/components/BarraEscritorio'
import {
  PosTerminal,
  type PosEntrada,
  type PosLista,
  type PosProduct,
} from '@/components/PosTerminal'
import { abrirTurnoForm } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Caja · REGB ERP' }

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Caja (S21). Sin turno abierto no se vende: sin eso no hay arqueo posible. */
export default async function PosPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'pos', 'pos.sell')

  const [turno, productos, clientes, resumen, almacenes, ncfOk, listas, entradas] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [t] = await tx<
        {
          id: string
          warehouse_id: string
          warehouse_name: string
          opening_float: string
          opened_at: string
        }[]
      >`
        select s.id, s.warehouse_id, w.name as warehouse_name,
               s.opening_float::text, s.opened_at::text
        from public.pos_shifts s
        join public.warehouses w on w.id = s.warehouse_id
        where s.tenant_id = ${ctx.tenantId} and s.status = 'open'
        order by s.opened_at desc limit 1`

      const p = t
        ? await tx<
            {
              id: string
              sku: string
              name: string
              unit: string
              barcode: string | null
              price: string
              tax_rate: string
              disponible: string
            }[]
          >`
            select pr.id, pr.sku, pr.name, pr.unit, pr.barcode, pr.price::text, pr.tax_rate::text,
                   coalesce(sl.qty_on_hand - sl.qty_reserved, 0)::text as disponible
            from public.products pr
            left join public.stock_levels sl
              on sl.product_id = pr.id and sl.warehouse_id = ${t.warehouse_id}
             and sl.tenant_id = ${ctx.tenantId}
            where pr.tenant_id = ${ctx.tenantId} and pr.active
            order by pr.name limit 300`
        : []

      const c = await tx<{ id: string; name: string }[]>`
        select id, name from public.customers
        where tenant_id = ${ctx.tenantId} and is_active order by name limit 200`

      const [r] = t
        ? await tx<{ tickets: string; vendido: string; efectivo: string }[]>`
            select count(distinct s.id)::text as tickets,
                   coalesce(sum(distinct s.total), 0)::text as vendido,
                   coalesce((select sum(p.amount) from public.pos_payments p
                              join public.pos_sales sa on sa.id = p.sale_id
                              where sa.shift_id = ${t.id} and not sa.voided
                                and p.method = 'cash'), 0)::text as efectivo
            from public.pos_sales s
            where s.shift_id = ${t.id} and s.tenant_id = ${ctx.tenantId} and not s.voided`
        : [undefined]

      const w = await tx<{ id: string; name: string }[]>`
        select id, name from public.warehouses
        where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`

      // Listas de precio para que el terminal cobre lo mismo que ensena.
      // Si el modulo esta apagado, RLS deja las dos consultas en cero
      // filas y todo cae al precio del catalogo: no hace falta preguntar
      // por el id de ningun modulo.
      const pl = await tx<PosLista[]>`
        select id, scope, customer_id as "customerId", channel,
               start_date::text as "startDate", end_date::text as "endDate", status
        from public.price_lists where tenant_id = ${ctx.tenantId}`

      const pe = await tx<PosEntrada[]>`
        select price_list_id as "priceListId", product_id as "productId",
               min_quantity::float8 as "minQuantity", unit_price::float8 as "unitPrice"
        from public.price_list_entries where tenant_id = ${ctx.tenantId}`

      // Se pregunta ANTES de vender, no despues. Un cajero que descubre
      // que no hay comprobante fiscal cuando el cliente ya pago no puede
      // hacer nada; sabiendolo al abrir la caja, avisa al dueno a tiempo.
      const [n] = await tx<{ ok: boolean }[]>`
        select exists (
          select 1 from public.ncf_sequences
          where tenant_id = ${ctx.tenantId} and ncf_type = 'B02' and is_active
            and expires_on >= current_date and next_number <= range_to
        ) as ok`

      return [t, p, c, r, w, n?.ok ?? false, pl, pe] as const
    },
  )

  const puedeAbrir = exigir(ctx, 'pos', 'pos.shift.open').ok
  const puedeDescuento = exigir(ctx, 'pos', 'pos.discount').ok
  const qs = ctx.demoQs
  const hidden: Record<string, string> = qs
    ? { tenant: ctx.tenantSlug, rol: ctx.roleName }
    : { tenant: '', rol: '' }

  const items: PosProduct[] = productos.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    unit: p.unit,
    barcode: p.barcode,
    price: Number(p.price),
    taxRate: Number(p.tax_rate),
    disponible: Number(p.disponible),
  }))

  return (
    <Shell {...shell} activePath="/pos">
      <div className="space-y-4">
        <PageHeader
          icon="point_of_sale"
          title="Caja"
          description={
            turno
              ? `Turno abierto en ${turno.warehouse_name} desde las ${new Date(turno.opened_at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}.`
              : 'Abre un turno para empezar a vender. Sin turno no hay arqueo al cerrar.'
          }
          actions={
            turno && (
              <a
                href={`/pos/shifts${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="lock_clock" size={18} />
                Cerrar turno
              </a>
            )
          }
        />

        <BarraEscritorio />

        {turno && !ncfOk && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_12%,transparent)] p-4 text-sm"
          >
            <Icon
              name="receipt_long"
              size={20}
              filled
              className="shrink-0 text-[var(--color-semantic-text-warning)]"
            />
            <p className="text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">
                No hay secuencia de NCF disponible.
              </strong>{' '}
              Se puede seguir vendiendo, pero los tickets saldran sin comprobante fiscal y no
              serviran para credito fiscal.{' '}
              <a
                href={`/cobrar/ncf${qs}`}
                className="text-[var(--color-text-link)] underline hover:no-underline"
              >
                Carga la autorizacion de la DGII
              </a>{' '}
              — pedirla toma dias.
            </p>
          </div>
        )}

        {turno ? (
          <>
            <section aria-label="Turno" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Tickets"
                value={String(resumen?.tickets ?? 0)}
                hint="en este turno"
              />
              <StatCard
                label="Vendido"
                value={`RD$ ${money(Number(resumen?.vendido ?? 0))}`}
                hint="sin anulados"
              />
              <StatCard
                label="En gaveta"
                value={`RD$ ${money(Number(turno.opening_float) + Number(resumen?.efectivo ?? 0))}`}
                hint="fondo + efectivo"
              />
              <StatCard label="Productos" value={String(items.length)} hint="a la venta" />
            </section>

            <PosTerminal
              shiftId={turno.id}
              products={items}
              customers={clientes}
              listas={listas}
              entradas={entradas}
              puedeDescuento={puedeDescuento}
              hiddenFields={hidden}
            />
          </>
        ) : puedeAbrir && almacenes.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Abrir turno</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={abrirTurnoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={hidden.tenant} />
                <input type="hidden" name="rol" value={hidden.rol} />
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Caja / almacen
                  <select
                    name="warehouseId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {almacenes.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fondo de apertura
                  <input
                    name="openingFloat"
                    inputMode="decimal"
                    defaultValue="0"
                    title="Lo que hay en la gaveta al empezar"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-right text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="lock_open" size={18} />
                  Abrir caja
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                El fondo es el efectivo con que empiezas. Al cerrar se compara con lo que cuentes.
              </p>
            </CardBody>
          </Card>
        ) : (
          <EmptyState
            icon="lock"
            title="No hay turno abierto"
            description="Tu rol no puede abrir la caja. Pidele a un encargado que abra el turno."
          />
        )}
      </div>
    </Shell>
  )
}
