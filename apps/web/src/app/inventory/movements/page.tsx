import { Badge, EmptyState, Mono, Table, THead, TBody, TR, TH, TD } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

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
}

/** Kardex (S19): cada movimiento, en orden. No hay boton de editar — es el punto. */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { producto?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'inventory')
  const productoFiltro = params.producto ?? ''

  const movements = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<MovementRow[]>`
      select m.id, p.sku, p.name, w.name as warehouse_name, m.movement_type,
             m.qty::text, m.unit_cost::text, m.reason, m.reference_type,
             up.display_name as created_by_name, m.created_at::text
      from public.inventory_movements m
      join public.products p on p.id = m.product_id
      join public.warehouses w on w.id = m.warehouse_id
      left join public.user_profiles up
        on up.tenant_id = m.tenant_id and up.user_id = m.created_by
      where m.tenant_id = ${ctx.tenantId}
        and (${productoFiltro} = '' or m.product_id = ${productoFiltro || null}::uuid)
      order by m.created_at desc
      limit 200`,
  )

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
        <div>
          <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
            <a href={`/inventory${qs}`} className="text-[var(--color-text-link)] hover:underline">
              Existencias
            </a>{' '}
            › Movimientos
          </nav>
          <h1 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">Kardex</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Cada entrada y salida, en orden. Corregir un movimiento se hace con otro movimiento,
            nunca editando este.
          </p>
        </div>

        {movements.length === 0 ? (
          <EmptyState
            icon="history"
            title="Sin movimientos todavia"
            description="Cuando registres una entrada, venta, ajuste o transferencia, aparecera aqui."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuando</TH>
                <TH>Producto</TH>
                <TH>Almacén</TH>
                <TH>Tipo</TH>
                <TH numeric>Cantidad</TH>
                {veCosto && <TH numeric>Costo</TH>}
                <TH>Motivo</TH>
                <TH>Quien</TH>
              </TR>
            </THead>
            <TBody>
              {movements.map((m) => {
                const qty = Number(m.qty)
                return (
                  <TR key={m.id}>
                    <TD>{fecha(m.created_at)}</TD>
                    <TD>
                      <Mono>{m.sku}</Mono> {m.name}
                    </TD>
                    <TD>{m.warehouse_name}</TD>
                    <TD>
                      <Badge tone={qty > 0 ? 'success' : 'neutral'} dot={false}>
                        {TIPO_LABEL[m.movement_type] ?? m.movement_type}
                      </Badge>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular ${qty < 0 ? 'text-[var(--color-semantic-text-danger)]' : ''}`}
                      >
                        {qty > 0 ? '+' : ''}
                        {qty}
                      </span>
                    </TD>
                    {veCosto && (
                      <TD numeric>
                        <span className="tabular">
                          {m.unit_cost ? Number(m.unit_cost).toFixed(2) : '—'}
                        </span>
                      </TD>
                    )}
                    <TD>{m.reason ?? '—'}</TD>
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
