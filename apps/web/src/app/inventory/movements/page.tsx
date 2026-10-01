import { Badge, EmptyState, Mono, PageHeader, Table, THead, TBody, TR, TH, TD } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { cantidadConSigno, pesos } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Movimientos · REGB ERP' }

interface MovementRow {
  id: string
  sku: string
  name: string
  warehouse_name: string
  movement_type: string
  qty: string
  unit_cost: string | null
  reason: string | null
  notes: string | null
  reference_type: string | null
  created_by_name: string | null
  created_at: string
}

const TIPO_LABEL: Record<string, string> = {
  receipt: 'Entrada',
  sale: 'Venta',
  adjustment_in: 'Ajuste (+)',
  adjustment_out: 'Ajuste (-)',
  transfer_in: 'Transferencia (entra)',
  transfer_out: 'Transferencia (sale)',
  reservation: 'Reserva',
  reservation_release: 'Libera reserva',
  count_adjustment: 'Conteo',
  return_to_supplier: 'Devolución a proveedor',
}

/** Entradas en verde; salidas y apartados en gris: el color no es el signo. */
const TIPO_TONO: Record<string, 'success' | 'neutral' | 'info' | 'warning'> = {
  receipt: 'success',
  adjustment_in: 'success',
  transfer_in: 'success',
  sale: 'neutral',
  adjustment_out: 'warning',
  transfer_out: 'neutral',
  reservation: 'info',
  reservation_release: 'info',
  count_adjustment: 'warning',
  return_to_supplier: 'warning',
}

/** Cuando nadie escribió un motivo, se dice de dónde vino el movimiento. */
const ORIGEN_LABEL: Record<string, string> = {
  pos_sale: 'Venta en caja',
  sales_order: 'Pedido de cliente',
  goods_receipt: 'Recepción de compra',
  purchase_order: 'Orden de compra',
  transfer_order: 'Transferencia entre almacenes',
  stock_transfer: 'Traslado rápido',
  product_lot: 'Registro de lote',
  import_batch: 'Carga desde CSV',
  stock_count: 'Conteo físico',
  cycle_count: 'Conteo cíclico',
  production_order: 'Orden de producción',
  supplier_return: 'Devolución a proveedor',
}

/** Kardex (S19): cada movimiento, en orden. No hay boton de editar — es el punto. */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { producto?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'inventory')
  // Un id mal copiado en la URL no tumba la pantalla: se ignora el filtro.
  const productoFiltro = /^[0-9a-f-]{36}$/i.test(params.producto ?? '') ? params.producto! : ''

  const [movements, producto] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const m = await tx<MovementRow[]>`
      select m.id, p.sku, p.name, w.name as warehouse_name, m.movement_type,
             m.qty::text, m.unit_cost::text, m.reason, m.notes, m.reference_type,
             up.display_name as created_by_name, m.created_at::text
      from public.inventory_movements m
      join public.products p on p.id = m.product_id
      join public.warehouses w on w.id = m.warehouse_id
      left join public.user_profiles up
        on up.tenant_id = m.tenant_id and up.user_id = m.created_by
      where m.tenant_id = ${ctx.tenantId}
        and (${productoFiltro} = '' or m.product_id = ${productoFiltro || null}::uuid)
      order by m.created_at desc
      limit 200`
    const [p] = productoFiltro
      ? await tx<{ sku: string; name: string }[]>`
          select sku, name from public.products
          where id = ${productoFiltro}::uuid and tenant_id = ${ctx.tenantId}`
      : []
    return [m, p] as const
  })

  const veCosto = exigir(ctx, 'inventory', 'inventory.cost.view').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/inventory/movements">
      <div className="space-y-5">
        <PageHeader
          icon="history"
          title={producto ? `Kardex de ${producto.name}` : 'Kardex'}
          description="Cada entrada y salida, en orden. Corregir un movimiento se hace con otro movimiento, nunca editando este."
          crumbs={[
            { label: 'Existencias', href: `/inventory${qs}` },
            ...(producto
              ? [
                  { label: 'Movimientos', href: `/inventory/movements${qs}` },
                  { label: producto.sku },
                ]
              : [{ label: 'Movimientos' }]),
          ]}
        />

        {movements.length === 0 ? (
          <EmptyState
            icon="history"
            title="Sin movimientos todavía"
            description="Cuando registres una entrada, venta, ajuste o transferencia, aparecerá aquí."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuándo</TH>
                <TH>Producto</TH>
                <TH>Almacén</TH>
                <TH>Tipo</TH>
                <TH numeric>Cantidad</TH>
                {veCosto && <TH numeric>Costo</TH>}
                <TH>Motivo u origen</TH>
                <TH>Quién</TH>
              </TR>
            </THead>
            <TBody>
              {movements.map((m) => {
                const qty = Number(m.qty)
                return (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap">{fecha(m.created_at)}</TD>
                    <TD>
                      <Mono>{m.sku}</Mono> {m.name}
                    </TD>
                    <TD>{m.warehouse_name}</TD>
                    <TD>
                      <Badge tone={TIPO_TONO[m.movement_type] ?? 'neutral'} dot={false}>
                        {TIPO_LABEL[m.movement_type] ?? m.movement_type}
                      </Badge>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular ${qty < 0 ? 'text-[var(--color-semantic-text-danger)]' : ''}`}
                      >
                        {cantidadConSigno(qty)}
                      </span>
                    </TD>
                    {veCosto && (
                      <TD numeric>
                        <span className="tabular whitespace-nowrap">
                          {m.unit_cost ? pesos(m.unit_cost) : '—'}
                        </span>
                      </TD>
                    )}
                    <TD>
                      {m.reason ??
                        m.notes ??
                        (m.reference_type ? (ORIGEN_LABEL[m.reference_type] ?? '—') : '—')}
                    </TD>
                    <TD>{m.created_by_name ?? 'Sistema'}</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
