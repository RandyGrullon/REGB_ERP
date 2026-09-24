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
import { PUERTAS_NCF, primeraPuerta } from '@/lib/fiscal'
import { Shell } from '@/components/Shell'
import { BarraEscritorio } from '@/components/BarraEscritorio'
import {
  PosTerminal,
  type PosEntrada,
  type PosLista,
  type PosProduct,
} from '@/components/PosTerminal'
import { abrirTurnoForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { motivoSinTurno } from './sin-turno'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Caja · REGB ERP' }

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Sin turno y sin poder abrirlo: la causa verdadera (sin-turno.ts). Antes,
 * sin almacen, al Owner se le decia que su rol no podia abrir la caja.
 */
function SinTurnoVacio(props: Parameters<typeof motivoSinTurno>[0]) {
  const m = motivoSinTurno(props)
  if (!m) return null
  return (
    <EmptyState
      icon={m.icono}
      title={m.titulo}
      description={m.descripcion}
      action={
        m.enlace ? (
          <a
            href={m.enlace.href}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            {m.enlace.texto}
          </a>
        ) : undefined
      }
    />
  )
}

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
              tracks_stock: boolean
            }[]
          >`
            select pr.id, pr.sku, pr.name, pr.unit, pr.barcode, pr.price::text, pr.tax_rate::text,
                   pr.tracks_stock,
                   coalesce(sl.qty_on_hand - sl.qty_reserved, 0)::text as disponible
            from public.products pr
            left join public.stock_levels sl
              on sl.product_id = pr.id and sl.warehouse_id = ${t.warehouse_id}
             and sl.tenant_id = ${ctx.tenantId}
            where pr.tenant_id = ${ctx.tenantId} and pr.active
            order by pr.name limit 3000`
        : []

      const c = await tx<{ id: string; name: string }[]>`
        select id, name from public.customers
        where tenant_id = ${ctx.tenantId} and is_active order by name limit 200`

      const [r] = t
        ? await tx<{ tickets: string; vendido: string; efectivo: string }[]>`
            select count(distinct s.id)::text as tickets,
                   -- Sin distinct: dos tickets del mismo monto son dos ventas.
                   coalesce(sum(s.total), 0)::text as vendido,
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
            and expires_on >= public.hoy_fiscal() and next_number <= range_to
        ) as ok`

      return [t, p, c, r, w, n?.ok ?? false, pl, pe] as const
    },
  )

  // Enlace del aviso "No hay secuencia de NCF": la pantalla de la caja si
  // el rol administra comprobantes; si no, la de otra puerta que alcance;
  // si ninguna, no se enlaza un 404.
  const rutaNcf = exigir(ctx, 'pos', 'pos.ncf.manage').ok
    ? '/pos/comprobantes'
    : (primeraPuerta(ctx, PUERTAS_NCF)?.ruta ?? null)
  const puedeAbrir = exigir(ctx, 'pos', 'pos.shift.open').ok
  const puedeDescuento = exigir(ctx, 'pos', 'pos.discount').ok
  // El tope del rol (`pos.discount.max`) viaja a la caja para avisar AL
  // ESCRIBIR, no despues de cobrar. El servidor lo vuelve a comprobar.
  const tope = (ctx.role.permissions as Record<string, unknown>)['pos.discount.max']
  const topeDescuento = typeof tope === 'number' ? tope : null
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
    tracksStock: p.tracks_stock,
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
              {/* A la pantalla que ESTE rol puede abrir: la de la caja si
                  administra comprobantes, la de Por cobrar si llega por
                  ahi. Antes enlazaba siempre a /cobrar/ncf, que para un
                  colmado sin `ar` era un 404 (0129). */}
              {rutaNcf ? (
                <a
                  href={`${rutaNcf}${qs}`}
                  className="text-[var(--color-text-link)] underline hover:no-underline"
                >
                  Carga la autorizacion de la DGII
                </a>
              ) : (
                <>Avisale al dueño que cargue la autorizacion de la DGII en Caja › Comprobantes</>
              )}{' '}
              — pedirla toma días.
            </p>
          </div>
        )}

        {turno ? (
          <>
            {/* En el telefono las cuatro tarjetas se comian la primera pantalla
                y el cajero no veia sus productos: ahi van en una sola linea. */}
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)] sm:hidden">
              <span>
                <strong className="tabular text-[var(--color-text-primary)]">
                  {resumen?.tickets ?? 0}
                </strong>{' '}
                tickets
              </span>
              <span>
                <strong className="tabular text-[var(--color-text-primary)]">
                  RD$ {money(Number(resumen?.vendido ?? 0))}
                </strong>{' '}
                vendido
              </span>
              <span>
                <strong className="tabular text-[var(--color-text-primary)]">
                  RD$ {money(Number(turno.opening_float) + Number(resumen?.efectivo ?? 0))}
                </strong>{' '}
                en gaveta
              </span>
            </p>
            <section aria-label="Turno" className="hidden grid-cols-2 gap-3 sm:grid lg:grid-cols-4">
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
              topeDescuento={topeDescuento}
              hiddenFields={hidden}
            />
          </>
        ) : puedeAbrir && almacenes.length > 0 ? (
          <Card data-tour="turno-abrir">
            <CardHeader>
              <CardTitle>Abrir turno</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={abrirTurnoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={hidden.tenant} />
                <input type="hidden" name="rol" value={hidden.rol} />
                <label className="flex w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Caja / almacén
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
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="lock_open" size={18} />
                  Abrir caja
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                El fondo es el efectivo con que empiezas. Al cerrar se compara con lo que cuentes.
              </p>
            </CardBody>
          </Card>
        ) : (
          <SinTurnoVacio
            puedeAbrir={puedeAbrir}
            hayAlmacenes={almacenes.length > 0}
            // Sin el modulo, la RLS esconde los almacenes: no es que falten.
            tieneExistencias={ctx.licensedModules.has('inventory')}
            puedeCrearAlmacen={exigir(ctx, 'inventory', 'inventory.warehouses.manage').ok}
            qs={qs}
          />
        )}
      </div>
    </Shell>
  )
}
