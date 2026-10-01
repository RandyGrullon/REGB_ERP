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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearTransferenciaForm } from './actions'
import { ESTADO_TRANSFERENCIA } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Transferencias · REGB ERP' }

interface TransferenciaRow {
  id: string
  from_name: string
  to_name: string
  status: string
  lineas: string
  productos: string | null
  notes: string | null
  created_at: string
  dispatched_at: string | null
  received_at: string | null
}

interface AlmacenOption {
  id: string
  name: string
}

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'received') return 'success'
  if (estado === 'in_transit') return 'warning'
  if (estado === 'cancelled') return 'danger'
  return 'neutral'
}

/** Transferencias (modulo 50): despachado y recibido son dos momentos distintos, no uno. */
export default async function TransferenciasPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'transfers')

  const { transferencias, almacenes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const t = await tx<TransferenciaRow[]>`
      select tord.id, wf.name as from_name, wt.name as to_name, tord.status,
             (select count(*) from public.transfer_order_lines l where l.order_id = tord.id)::text as lineas,
             (select string_agg(p.name || ' · ' || trim_scale(l.qty_requested)::text || ' ' || p.unit, ', ' order by p.name)
                from public.transfer_order_lines l
                join public.products p on p.id = l.product_id
               where l.order_id = tord.id) as productos,
             tord.notes, tord.created_at::text, tord.dispatched_at::text, tord.received_at::text
      from public.transfer_orders tord
      join public.warehouses wf on wf.id = tord.from_warehouse_id
      join public.warehouses wt on wt.id = tord.to_warehouse_id
      where tord.tenant_id = ${ctx.tenantId}
      order by tord.created_at desc
      limit 50`
    const a = await tx<AlmacenOption[]>`
      select id, name from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
    return { transferencias: t, almacenes: a }
  })

  const enTransito = transferencias.filter((t) => t.status === 'in_transit').length
  const porDespachar = transferencias.filter((t) => t.status === 'draft').length
  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
  const puedeCrear = exigir(ctx, 'transfers', 'transfers.create').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/transferencias">
      <div className="space-y-5">
        <PageHeader
          icon="local_shipping"
          title="Transferencias"
          description="Al despacharla, la mercancía sale del almacén de origen; al recibirla, entra al de destino. Mientras tanto queda en tránsito."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="En tránsito"
            value={String(enTransito)}
            hint="salieron y no han llegado"
          />
          <StatCard label="Por despachar" value={String(porDespachar)} hint="en borrador" />
          <StatCard label="Total" value={String(transferencias.length)} hint="las últimas 50" />
        </section>

        {transferencias.length === 0 ? (
          <EmptyState
            icon="local_shipping"
            title="Todavía no hay ninguna transferencia"
            description={
              almacenes.length < 2
                ? 'Para transferir hace falta un segundo almacén: una sucursal, un depósito o el camión de reparto.'
                : 'Crea la primera abajo: eliges de dónde sale y a dónde va, le agregas los productos y la despachas.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Creada</TH>
                <TH>De</TH>
                <TH>A</TH>
                <TH>Qué se mueve</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {transferencias.map((t) => (
                <TR key={t.id}>
                  <TD className="whitespace-nowrap">
                    <a
                      href={`/transferencias/${t.id}${qs}`}
                      className="font-medium text-[var(--color-text-link)] underline-offset-2 hover:underline"
                    >
                      {fecha(t.created_at)}
                    </a>
                  </TD>
                  <TD className="text-[var(--color-text-primary)]">{t.from_name}</TD>
                  <TD className="text-[var(--color-text-primary)]">{t.to_name}</TD>
                  <TD>
                    <span className="line-clamp-2">{t.productos ?? 'Sin productos todavía'}</span>
                    {t.notes && (
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {t.notes}
                      </span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">
                    <Badge tone={badgeTono(t.status)}>
                      {ESTADO_TRANSFERENCIA[t.status] ?? t.status}
                    </Badge>
                    {t.status === 'received' && t.received_at && (
                      <span className="block pt-1 text-xs text-[var(--color-text-muted)]">
                        el {fecha(t.received_at)}
                      </span>
                    )}
                    {t.status === 'in_transit' && t.dispatched_at && (
                      <span className="block pt-1 text-xs text-[var(--color-text-muted)]">
                        salió el {fecha(t.dispatched_at)}
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeCrear && almacenes.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva transferencia</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearTransferenciaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  De
                  <select
                    name="fromWarehouseId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {almacenes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  A
                  <select
                    name="toWarehouseId"
                    required
                    // Otro almacen por defecto: con los dos iguales, el primer
                    // intento siempre rebotaba con "no pueden ser el mismo".
                    defaultValue={almacenes[1]?.id ?? almacenes[0]?.id}
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {almacenes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Notas
                  <input
                    name="notes"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
