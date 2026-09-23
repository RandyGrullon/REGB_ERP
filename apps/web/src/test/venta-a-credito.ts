import { db } from '@/lib/db'

/**
 * Datos de una venta a credito para las pruebas de acciones de pedidos y
 * por cobrar: almacen, producto con existencia, cliente, facturas viejas y
 * pedidos en el estado que la prueba necesite.
 *
 * Se siembran como DUENO de la base (sin RLS) porque son el "antes" de la
 * prueba, no lo que se prueba. Lo que se prueba -confirmar, facturar,
 * cobrar- va siempre por la accion real.
 */

/** Los modulos que usa una venta a credito: ar exige sales-orders, y este products. */
export const MODULOS_CREDITO = ['products', 'inventory', 'sales-orders', 'ar']

/** Tablas a vaciar antes de borrar el tenant, en orden de dependencia. */
export const TABLAS_CREDITO = [
  'public.customer_credit_note_lines',
  'public.customer_credit_notes',
  'public.credit_overrides',
  'public.ar_credit_policy',
  'public.customer_payments',
  'public.invoice_late_fees',
  'public.customer_invoices',
  'public.sales_order_lines',
  'public.sales_orders',
  'public.inventory_movements',
  'public.stock_levels',
  'public.customers',
  'public.products',
  'public.warehouses',
  'public.ncf_sequences',
]

/**
 * Tablas que quizas todavia no existan (las crea la 0130): limpiar no debe
 * caerse por eso cuando la prueba corre en rojo contra el codigo viejo.
 */
export async function limpiarCredito(
  limpiar: (antes?: string[]) => Promise<void>,
): Promise<void> {
  const existentes: string[] = []
  for (const t of TABLAS_CREDITO) {
    const [r] = await db()<{ ok: boolean }[]>`select to_regclass(${t}) is not null as ok`
    if (r!.ok) existentes.push(t)
  }
  await limpiar(existentes)
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function almacen(tenantId: string): Promise<string> {
  const [w] = await db()<{ id: string }[]>`
    insert into public.warehouses (tenant_id, name, code, is_default)
    values (${tenantId}, 'Almacen Principal', ${`ALM-${crypto.randomUUID().slice(0, 4)}`}, true)
    returning id`
  return w!.id
}

export async function producto(
  tenantId: string,
  warehouseId: string,
  p: { sku: string; precio: number; existencia?: number; costo?: number },
): Promise<string> {
  const [prod] = await db()<{ id: string }[]>`
    insert into public.products (tenant_id, sku, name, price, tax_rate)
    values (${tenantId}, ${p.sku}, ${`Producto ${p.sku}`}, ${p.precio}, 0.18)
    returning id`
  if (p.existencia) {
    await db()`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost, reason)
      values (${tenantId}, ${warehouseId}, ${prod!.id}, 'receipt', ${p.existencia},
              ${p.costo ?? r2(p.precio * 0.6)}, 'Existencia inicial de prueba')`
  }
  return prod!.id
}

export async function cliente(
  tenantId: string,
  c: { nombre: string; rnc?: string | null; dias?: number; limite?: number | null },
): Promise<string> {
  const [row] = await db()<{ id: string }[]>`
    insert into public.customers (tenant_id, name, tax_id, payment_terms, credit_limit)
    values (${tenantId}, ${c.nombre}, ${c.rnc ?? null}, ${c.dias ?? 30}, ${c.limite ?? null})
    returning id`
  return row!.id
}

/**
 * Una factura ya emitida. `diasVencida` positivo = vencio hace tantos
 * dias; negativo = todavia no vence.
 */
export async function factura(
  tenantId: string,
  customerId: string,
  f: { numero: string; total: number; diasVencida: number; plazo?: number; ncf?: string | null },
): Promise<string> {
  const plazo = f.plazo ?? 30
  const subtotal = r2(f.total / 1.18)
  const tax = r2(f.total - subtotal)
  const [row] = await db()<{ id: string }[]>`
    insert into public.customer_invoices
      (tenant_id, number, customer_id, source_type, issue_date, due_date,
       subtotal, tax, total, status, ncf, ncf_type)
    values (${tenantId}, ${f.numero}, ${customerId}, 'manual',
            current_date - ${f.diasVencida + plazo}::int, current_date - ${f.diasVencida}::int,
            ${subtotal}, ${tax}, ${f.total},
            ${f.diasVencida > 0 ? 'overdue' : 'open'},
            ${f.ncf ?? null}, ${f.ncf ? f.ncf.slice(0, 3) : null})
    returning id`
  return row!.id
}

export async function mora(
  tenantId: string,
  invoiceId: string,
  monto: number,
  dias: number,
): Promise<void> {
  await db()`
    insert into public.invoice_late_fees (tenant_id, invoice_id, amount, days_late_at_charge, notes)
    values (${tenantId}, ${invoiceId}, ${monto}, ${dias}, 'Mora decidida por el dueno')`
}

/**
 * Un pedido con una sola linea. `estado`:
 *  - draft: listo para confirmar.
 *  - confirmed: confirmado, sin entregar (cuenta como credito comprometido).
 *  - delivered: entregado completo, listo para facturar.
 */
export async function pedido(
  tenantId: string,
  p: {
    customerId: string
    warehouseId: string
    productId: string
    cantidad: number
    precio: number
    estado: 'draft' | 'confirmed' | 'delivered'
  },
): Promise<string> {
  const subtotal = r2(p.cantidad * p.precio)
  const tax = r2(subtotal * 0.18)
  const total = r2(subtotal + tax)
  const [o] = await db()<{ id: string }[]>`
    insert into public.sales_orders
      (tenant_id, number, customer_id, warehouse_id, status, subtotal, tax, total,
       confirmed_at)
    values (${tenantId}, ${`PV-T-${crypto.randomUUID().slice(0, 8)}`}, ${p.customerId},
            ${p.warehouseId}, ${p.estado}, ${subtotal}, ${tax}, ${total},
            ${p.estado === 'draft' ? null : new Date()})
    returning id`
  const entregado = p.estado === 'delivered' ? p.cantidad : 0
  await db()`
    insert into public.sales_order_lines
      (order_id, tenant_id, product_id, qty_ordered, qty_delivered, unit_price,
       discount_pct, tax_rate, line_total)
    values (${o!.id}, ${tenantId}, ${p.productId}, ${p.cantidad}, ${entregado}, ${p.precio},
            0, 0.18, ${total})`
  return o!.id
}

/** Secuencia NCF autorizada y vigente. */
export async function secuencia(tenantId: string, tipo: string, desde = 1): Promise<void> {
  await db()`
    insert into public.ncf_sequences
      (tenant_id, ncf_type, range_from, range_to, next_number, expires_on, authorization_ref)
    values (${tenantId}, ${tipo}, ${desde}, ${desde + 999}, ${desde},
            current_date + 365, 'AUT-PRUEBA')`
}

export async function proximoNcf(tenantId: string, tipo: string): Promise<number | null> {
  const [s] = await db()<{ next_number: number }[]>`
    select next_number from public.ncf_sequences
    where tenant_id = ${tenantId} and ncf_type = ${tipo} and is_active`
  return s?.next_number ?? null
}

export async function saldo(invoiceId: string): Promise<number> {
  const [s] = await db()<{ saldo: string }[]>`
    select public.invoice_balance(${invoiceId})::text as saldo`
  return Number(s!.saldo)
}

export async function estadoFactura(invoiceId: string): Promise<string> {
  const [s] = await db()<{ status: string }[]>`
    select status from public.customer_invoices where id = ${invoiceId}`
  return s!.status
}
