import type postgres from 'postgres'
import { fuenteValida, type FuenteReporte } from '@regb/operations'

/**
 * Catalogo fijo de fuentes de reporte -nunca SQL libre del tenant-.
 * Cada fuente ya respeta RLS y `module_active()` de las tablas que
 * consulta: si un modulo recomendado no esta activo, esa tabla ya
 * devuelve cero filas por su cuenta.
 */

export interface ColumnaReporte {
  key: string
  label: string
  numeric?: boolean
}

export interface ResultadoReporte {
  columnas: ColumnaReporte[]
  filas: Record<string, string | number>[]
}

async function sourceSalesByDay(tx: postgres.TransactionSql, tenantId: string, params: Record<string, unknown>): Promise<ResultadoReporte> {
  const dias = Number(params.days ?? 14) || 14
  const filas = await tx<{ dia: string; total: string }[]>`
    select date_trunc('day', sold_at)::date::text as dia, coalesce(sum(total), 0)::text as total
    from public.pos_sales
    where tenant_id = ${tenantId} and not voided and sold_at >= now() - (${dias} || ' days')::interval
    group by 1 order by 1`
  return {
    columnas: [
      { key: 'dia', label: 'Dia' },
      { key: 'total', label: 'Total (RD$)', numeric: true },
    ],
    filas: filas.map((r) => ({ dia: r.dia, total: Number(r.total) })),
  }
}

async function sourceTopProducts(tx: postgres.TransactionSql, tenantId: string, params: Record<string, unknown>): Promise<ResultadoReporte> {
  const dias = Number(params.days ?? 30) || 30
  const limite = Number(params.limit ?? 10) || 10
  const filas = await tx<{ name: string; unidades: string; importe: string }[]>`
    with ventas as (
      select l.product_id, l.qty as unidades, l.line_total as importe
      from public.pos_sale_lines l
      join public.pos_sales s on s.id = l.sale_id
      where l.tenant_id = ${tenantId} and not s.voided
        and s.sold_at >= now() - (${dias} || ' days')::interval
      union all
      select l.product_id, l.qty_delivered,
             l.line_total * (l.qty_delivered / nullif(l.qty_ordered, 0))
      from public.sales_order_lines l
      join public.sales_orders o on o.id = l.order_id
      where l.tenant_id = ${tenantId} and o.status <> 'cancelled'
        and l.qty_delivered > 0
        and o.created_at >= now() - (${dias} || ' days')::interval
    )
    select p.name, sum(v.unidades)::text as unidades, sum(v.importe)::text as importe
    from ventas v
    join public.products p on p.id = v.product_id
    group by p.name
    order by sum(v.importe) desc
    limit ${limite}`
  return {
    columnas: [
      { key: 'name', label: 'Producto' },
      { key: 'unidades', label: 'Unidades', numeric: true },
      { key: 'importe', label: 'Importe (RD$)', numeric: true },
    ],
    filas: filas.map((r) => ({ name: r.name, unidades: Number(r.unidades), importe: Number(r.importe) })),
  }
}

async function sourceOverdueInvoices(tx: postgres.TransactionSql, tenantId: string, params: Record<string, unknown>): Promise<ResultadoReporte> {
  const limite = Number(params.limit ?? 20) || 20
  const filas = await tx<{ customer: string; total: string; dias: string }[]>`
    select c.name as customer, public.invoice_balance(i.id)::text as total, (current_date - i.due_date)::text as dias
    from public.customer_invoices i
    join public.customers c on c.id = i.customer_id
    where i.tenant_id = ${tenantId} and i.status not in ('paid', 'void') and i.due_date < current_date
    order by i.due_date
    limit ${limite}`
  return {
    columnas: [
      { key: 'customer', label: 'Cliente' },
      { key: 'total', label: 'Pendiente (RD$)', numeric: true },
      { key: 'dias', label: 'Dias vencida', numeric: true },
    ],
    filas: filas.map((r) => ({ customer: r.customer, total: Number(r.total), dias: Number(r.dias) })),
  }
}

async function sourceLeadsByStatus(tx: postgres.TransactionSql, tenantId: string): Promise<ResultadoReporte> {
  const filas = await tx<{ status: string; n: string }[]>`
    select status, count(*)::text as n from public.leads where tenant_id = ${tenantId} group by status order by status`
  return {
    columnas: [
      { key: 'status', label: 'Estado' },
      { key: 'n', label: 'Leads', numeric: true },
    ],
    filas: filas.map((r) => ({ status: r.status, n: Number(r.n) })),
  }
}

async function sourceTicketsByPriority(tx: postgres.TransactionSql, tenantId: string): Promise<ResultadoReporte> {
  const filas = await tx<{ priority: string; n: string }[]>`
    select priority, count(*)::text as n from public.tickets where tenant_id = ${tenantId} group by priority order by priority`
  return {
    columnas: [
      { key: 'priority', label: 'Prioridad' },
      { key: 'n', label: 'Tickets', numeric: true },
    ],
    filas: filas.map((r) => ({ priority: r.priority, n: Number(r.n) })),
  }
}

export const FUENTE_LABEL: Record<FuenteReporte, string> = {
  sales_by_day: 'Ventas por dia',
  top_products: 'Productos mas vendidos',
  overdue_invoices: 'Facturas vencidas',
  leads_by_status: 'Leads por estado',
  tickets_by_priority: 'Tickets por prioridad',
}

export async function ejecutarReporte(
  tx: postgres.TransactionSql,
  tenantId: string,
  sourceKey: string,
  params: Record<string, unknown>,
): Promise<ResultadoReporte> {
  if (!fuenteValida(sourceKey)) return { columnas: [], filas: [] }
  switch (sourceKey) {
    case 'sales_by_day':
      return sourceSalesByDay(tx, tenantId, params)
    case 'top_products':
      return sourceTopProducts(tx, tenantId, params)
    case 'overdue_invoices':
      return sourceOverdueInvoices(tx, tenantId, params)
    case 'leads_by_status':
      return sourceLeadsByStatus(tx, tenantId)
    case 'tickets_by_priority':
      return sourceTicketsByPriority(tx, tenantId)
  }
}
