import 'server-only'

import type postgres from 'postgres'
import {
  asientoCargoMora,
  asientoCobroCliente,
  asientoFacturaCredito,
  asientoFacturaProveedor,
  asientoNotaCredito,
  asientoPagoProveedor,
  asientoVentaContado,
  invertirAsiento,
  type LineaAutomatica,
} from '@regb/operations'
import type { EventoPendiente } from './despachador'

/**
 * Contabilidad automatica: los handlers del bus que convierten un hecho
 * de la operacion en su asiento (ADR 0001, migracion 0131).
 *
 * Cada handler hace lo mismo en tres pasos:
 *
 *   1. Lee el documento de ORIGEN por el id que trae el evento -el
 *      payload de los emisores es delgado a proposito, y el documento es
 *      la verdad (si se anulo entre tanto, se ve)-.
 *   2. Pide las lineas a `@regb/operations/asientos.ts`, que decide por
 *      PROPOSITO (caja, cxc, ventas...) sin saber de cuentas.
 *   3. Llama a `registrar_asiento_automatico()`, que traduce con el mapa
 *      del cliente, contabiliza y es idempotente por origen.
 *
 * Todo handler es idempotente -la entrega es at-least-once- y ninguno
 * falla por un cliente sin `accounting`: la funcion SQL devuelve null y
 * el evento se da por atendido. Lo que SI falla (y se reintenta con la
 * espera del despachador) es un mapa roto: una cuenta desactivada o un
 * uso sin asignar. Ahi el asiento no se pierde: sale cuando se corrige.
 *
 * Las consultas corren con el cliente del despachador (dueno, sin RLS):
 * cada una filtra por el `tenant_id` del EVENTO, que escribio el
 * outbox en la transaccion del emisor -nunca el payload-.
 */

type Sql = postgres.Sql
export type HandlerContable = (e: EventoPendiente, sql: Sql) => Promise<void>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** El id que trae el payload, o null si no es un uuid (payload roto: no hay que reintentar). */
function idDe(e: EventoPendiente, clave: string): string | null {
  const v = String(e.payload[clave] ?? '')
  return UUID.test(v) ? v : null
}

/**
 * Salida rapida: sin `accounting` no se lee nada. La funcion SQL lo
 * vuelve a comprobar -es la que manda-; esto solo ahorra consultas.
 */
async function contabilidadActiva(sql: Sql, tenantId: string): Promise<boolean> {
  const [m] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from regb.tenant_modules
      where tenant_id = ${tenantId} and module_id = 'accounting'
        and status in ('trial', 'active') and enabled
    ) as ok`
  return Boolean(m?.ok)
}

async function registrar(
  sql: Sql,
  e: EventoPendiente,
  asiento: {
    sourceType: string
    sourceId: string
    fecha: string
    descripcion: string
    lineas: LineaAutomatica[]
  },
): Promise<string | null> {
  if (asiento.lineas.length === 0) return null
  const [r] = await sql<{ id: string | null }[]>`
    select public.registrar_asiento_automatico(
      ${e.tenant_id}::uuid, ${asiento.sourceType}, ${asiento.sourceId}::uuid,
      ${asiento.fecha}::date, ${asiento.descripcion},
      ${JSON.stringify(asiento.lineas)}::text::jsonb, ${e.id}::bigint) as id`
  return r?.id ?? null
}

/** Ya tiene asiento este origen? (para no reversar lo que no existe) */
async function lineasDelAsiento(
  sql: Sql,
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<{ accountId: string; debit: string; credit: string; memo: string | null }[] | null> {
  const [a] = await sql<{ id: string }[]>`
    select id from public.journal_entries
    where tenant_id = ${tenantId} and source_type = ${sourceType} and source_id = ${sourceId}`
  if (!a) return null
  return sql<{ accountId: string; debit: string; credit: string; memo: string | null }[]>`
    select account_id as "accountId", debit::text, credit::text, memo
    from public.journal_entry_lines where entry_id = ${a.id} order by id`
}

/**
 * Reverso de un asiento automatico: mismas cuentas, lados cambiados. Antes
 * se asegura el original -si el evento de anulacion llega antes que el de
 * emision (un reintento pendiente), o si contabilidad se activo despues
 * de la venta-: una anulacion nunca deja el mayor con medio hecho.
 */
async function reversar(
  sql: Sql,
  e: EventoPendiente,
  original: { sourceType: string; sourceId: string; asegurar: () => Promise<void> },
  reverso: { sourceType: string; fecha: string; descripcion: string },
): Promise<void> {
  await original.asegurar()
  const lineas = await lineasDelAsiento(sql, e.tenant_id, original.sourceType, original.sourceId)
  if (!lineas || lineas.length === 0) return
  await registrar(sql, e, {
    sourceType: reverso.sourceType,
    sourceId: original.sourceId,
    fecha: reverso.fecha,
    descripcion: reverso.descripcion,
    lineas: invertirAsiento(lineas),
  })
}

// ── Caja ────────────────────────────────────────────────────────────────

async function contabilizarVentaCaja(sql: Sql, e: EventoPendiente, saleId: string): Promise<void> {
  const [v] = await sql<
    { number: string; total: string; tax: string; fecha: string; warehouse_id: string }[]
  >`
    select s.number, s.total::text, s.tax::text,
           (s.sold_at at time zone t.timezone)::date::text as fecha, sh.warehouse_id
    from public.pos_sales s
    join public.pos_shifts sh on sh.id = s.shift_id
    join regb.tenants t on t.id = s.tenant_id
    where s.id = ${saleId} and s.tenant_id = ${e.tenant_id}`
  if (!v) return

  const pagos = await sql<{ method: string; amount: string }[]>`
    select method, amount::text from public.pos_payments
    where sale_id = ${saleId} and tenant_id = ${e.tenant_id}`

  // Costo de lo vendido al costo promedio del almacen de la caja. El
  // kardex no guarda el costo de las salidas (0019), asi que es el
  // promedio AL CONTABILIZAR: con el despachador al dia es el mismo de la
  // venta; si una compra entra entre la venta y el despacho, lo mueve.
  const [c] = await sql<{ costo: string }[]>`
    select coalesce(sum(l.qty * coalesce(sl.avg_cost, 0)), 0)::numeric(14,2)::text as costo
    from public.pos_sale_lines l
    join public.products p on p.id = l.product_id and p.tracks_stock
    left join public.stock_levels sl
      on sl.tenant_id = l.tenant_id and sl.warehouse_id = ${v.warehouse_id}
     and sl.product_id = l.product_id
    where l.sale_id = ${saleId} and l.tenant_id = ${e.tenant_id}`

  await registrar(sql, e, {
    sourceType: 'pos_sale',
    sourceId: saleId,
    fecha: v.fecha,
    descripcion: `Venta de caja ${v.number}`,
    lineas: asientoVentaContado({
      total: v.total,
      impuesto: v.tax,
      pagos,
      costo: c?.costo ?? 0,
    }),
  })
}

const ventaCajaCompletada: HandlerContable = async (e, sql) => {
  const saleId = idDe(e, 'saleId')
  if (!saleId || !(await contabilidadActiva(sql, e.tenant_id))) return
  await contabilizarVentaCaja(sql, e, saleId)
}

const ventaCajaAnulada: HandlerContable = async (e, sql) => {
  const saleId = idDe(e, 'saleId')
  if (!saleId || !(await contabilidadActiva(sql, e.tenant_id))) return
  const [v] = await sql<{ number: string; fecha: string }[]>`
    select s.number,
           (coalesce(s.voided_at, now()) at time zone t.timezone)::date::text as fecha
    from public.pos_sales s join regb.tenants t on t.id = s.tenant_id
    where s.id = ${saleId} and s.tenant_id = ${e.tenant_id} and s.voided`
  if (!v) return
  await reversar(
    sql,
    e,
    {
      sourceType: 'pos_sale',
      sourceId: saleId,
      asegurar: () => contabilizarVentaCaja(sql, e, saleId),
    },
    { sourceType: 'pos_sale_void', fecha: v.fecha, descripcion: `Anulacion de la venta de caja ${v.number}` },
  )
}

// ── Cuentas por cobrar ──────────────────────────────────────────────────

async function contabilizarFacturaCliente(
  sql: Sql,
  e: EventoPendiente,
  invoiceId: string,
): Promise<void> {
  const [f] = await sql<{ number: string; total: string; tax: string; fecha: string; cliente: string }[]>`
    select i.number, i.total::text, i.tax::text, i.issue_date::text as fecha, c.name as cliente
    from public.customer_invoices i join public.customers c on c.id = i.customer_id
    where i.id = ${invoiceId} and i.tenant_id = ${e.tenant_id}`
  if (!f) return
  await registrar(sql, e, {
    sourceType: 'ar_invoice',
    sourceId: invoiceId,
    fecha: f.fecha,
    descripcion: `Factura a credito ${f.number} · ${f.cliente}`,
    lineas: asientoFacturaCredito({ total: f.total, impuesto: f.tax }),
  })
}

const facturaClienteEmitida: HandlerContable = async (e, sql) => {
  if (!(await contabilidadActiva(sql, e.tenant_id))) return
  // `ar.invoice.issued` trae el numero, no el id de la factura.
  const numero = String(e.payload.number ?? '')
  const id = idDe(e, 'invoiceId')
  const [f] = await sql<{ id: string }[]>`
    select id from public.customer_invoices
    where tenant_id = ${e.tenant_id}
      and (${id}::uuid is not null and id = ${id}::uuid or number = ${numero})
    limit 1`
  if (!f) return
  await contabilizarFacturaCliente(sql, e, f.id)
}

const facturaClienteAnulada: HandlerContable = async (e, sql) => {
  const invoiceId = idDe(e, 'invoiceId')
  if (!invoiceId || !(await contabilidadActiva(sql, e.tenant_id))) return
  const [f] = await sql<{ number: string }[]>`
    select number from public.customer_invoices
    where id = ${invoiceId} and tenant_id = ${e.tenant_id} and status = 'void'`
  if (!f) return
  const [hoy] = await sql<{ fecha: string }[]>`
    select (now() at time zone timezone)::date::text as fecha from regb.tenants where id = ${e.tenant_id}`
  await reversar(
    sql,
    e,
    {
      sourceType: 'ar_invoice',
      sourceId: invoiceId,
      asegurar: () => contabilizarFacturaCliente(sql, e, invoiceId),
    },
    { sourceType: 'ar_invoice_void', fecha: hoy!.fecha, descripcion: `Anulacion de la factura ${f.number}` },
  )
}

const cobroRecibido: HandlerContable = async (e, sql) => {
  const paymentId = idDe(e, 'paymentId')
  if (!paymentId || !(await contabilidadActiva(sql, e.tenant_id))) return
  const [p] = await sql<
    { invoice_id: string; amount: string; method: string; fecha: string; numero: string }[]
  >`
    select p.invoice_id, p.amount::text, p.method,
           (p.received_at at time zone t.timezone)::date::text as fecha, i.number as numero
    from public.customer_payments p
    join public.customer_invoices i on i.id = p.invoice_id
    join regb.tenants t on t.id = p.tenant_id
    where p.id = ${paymentId} and p.tenant_id = ${e.tenant_id}`
  if (!p) return
  // Un cobro nunca entra al mayor sin su factura: si la factura no tiene
  // asiento (anterior a contabilidad, o su evento sigue en cola), se
  // asienta primero. Si no, la cartera del mayor quedaria en negativo.
  await contabilizarFacturaCliente(sql, e, p.invoice_id)
  await registrar(sql, e, {
    sourceType: 'ar_payment',
    sourceId: paymentId,
    fecha: p.fecha,
    descripcion: `Cobro de la factura ${p.numero}`,
    lineas: asientoCobroCliente({ monto: p.amount, metodo: p.method }),
  })
}

/**
 * Cobro reversado (0130: un cobro mal digitado se reversa, no se borra).
 * Su asiento se reversa igual: mismas cuentas, lados cambiados.
 */
const cobroReversado: HandlerContable = async (e, sql) => {
  const paymentId = idDe(e, 'paymentId')
  if (!paymentId || !(await contabilidadActiva(sql, e.tenant_id))) return
  const [p] = await sql<{ fecha: string; numero: string }[]>`
    select (p.reversed_at at time zone t.timezone)::date::text as fecha, i.number as numero
    from public.customer_payments p
    join public.customer_invoices i on i.id = p.invoice_id
    join regb.tenants t on t.id = p.tenant_id
    where p.id = ${paymentId} and p.tenant_id = ${e.tenant_id} and p.reversed_at is not null`
  if (!p) return
  await reversar(
    sql,
    e,
    {
      sourceType: 'ar_payment',
      sourceId: paymentId,
      asegurar: () => cobroRecibido({ ...e, payload: { paymentId } }, sql),
    },
    {
      sourceType: 'ar_payment_reversal',
      fecha: p.fecha,
      descripcion: `Reverso del cobro de la factura ${p.numero}`,
    },
  )
}

/** Nota de credito (B04) sobre una factura a credito: la factura al reves por su monto. */
const notaCreditoEmitida: HandlerContable = async (e, sql) => {
  const notaId = idDe(e, 'creditNoteId')
  if (!notaId || !(await contabilidadActiva(sql, e.tenant_id))) return
  const [n] = await sql<
    { number: string; invoice_id: string; total: string; tax: string; fecha: string; factura: string }[]
  >`
    select n.number, n.invoice_id, n.total::text, n.tax::text, n.issue_date::text as fecha,
           i.number as factura
    from public.customer_credit_notes n
    join public.customer_invoices i on i.id = n.invoice_id
    where n.id = ${notaId} and n.tenant_id = ${e.tenant_id}`
  if (!n) return
  // La nota rebaja una factura: que la factura este en el mayor primero.
  await contabilizarFacturaCliente(sql, e, n.invoice_id)
  await registrar(sql, e, {
    sourceType: 'ar_credit_note',
    sourceId: notaId,
    fecha: n.fecha,
    descripcion: `Nota de credito ${n.number} a la factura ${n.factura}`,
    lineas: asientoNotaCredito({ total: n.total, impuesto: n.tax }),
  })
}

/** Cargo por mora: la cartera sube contra un ingreso aparte. */
const cargoMoraAplicado: HandlerContable = async (e, sql) => {
  const moraId = idDe(e, 'lateFeeId')
  if (!moraId || !(await contabilidadActiva(sql, e.tenant_id))) return
  const [m] = await sql<{ invoice_id: string; amount: string; fecha: string; factura: string }[]>`
    select f.invoice_id, f.amount::text, (f.applied_at at time zone t.timezone)::date::text as fecha,
           i.number as factura
    from public.invoice_late_fees f
    join public.customer_invoices i on i.id = f.invoice_id
    join regb.tenants t on t.id = f.tenant_id
    where f.id = ${moraId} and f.tenant_id = ${e.tenant_id}`
  if (!m) return
  await contabilizarFacturaCliente(sql, e, m.invoice_id)
  await registrar(sql, e, {
    sourceType: 'ar_late_fee',
    sourceId: moraId,
    fecha: m.fecha,
    descripcion: `Cargo por mora a la factura ${m.factura}`,
    lineas: asientoCargoMora({ monto: m.amount }),
  })
}

// ── Cuentas por pagar ───────────────────────────────────────────────────

async function contabilizarFacturaProveedor(
  sql: Sql,
  e: EventoPendiente,
  invoiceId: string,
): Promise<void> {
  const [f] = await sql<
    {
      numero: string
      proveedor: string
      total: string
      tax: string
      retention_amount: string
      isr_retained: string
      expense_type: string | null
      fecha: string
    }[]
  >`
    select i.supplier_invoice_number as numero, s.name as proveedor, i.total::text, i.tax::text,
           i.retention_amount::text, i.isr_retained::text, i.expense_type, i.issue_date::text as fecha
    from public.supplier_invoices i join public.suppliers s on s.id = i.supplier_id
    where i.id = ${invoiceId} and i.tenant_id = ${e.tenant_id}`
  if (!f) return
  await registrar(sql, e, {
    sourceType: 'ap_invoice',
    sourceId: invoiceId,
    fecha: f.fecha,
    descripcion: `Factura de proveedor ${f.numero} · ${f.proveedor}`,
    lineas: asientoFacturaProveedor({
      total: f.total,
      impuesto: f.tax,
      retencion: f.retention_amount,
      isrRetenido: f.isr_retained,
      tipoGasto: f.expense_type,
    }),
  })
}

const facturaProveedorRegistrada: HandlerContable = async (e, sql) => {
  if (!(await contabilidadActiva(sql, e.tenant_id))) return
  // `ap.invoice.recorded` trae proveedor + numero: es la clave unica.
  const proveedor = idDe(e, 'supplierId')
  const numero = String(e.payload.supplierInvoiceNumber ?? '')
  if (!proveedor || !numero) return
  const [f] = await sql<{ id: string }[]>`
    select id from public.supplier_invoices
    where tenant_id = ${e.tenant_id} and supplier_id = ${proveedor}
      and supplier_invoice_number = ${numero}`
  if (!f) return
  await contabilizarFacturaProveedor(sql, e, f.id)
}

const facturaProveedorAnulada: HandlerContable = async (e, sql) => {
  const invoiceId = idDe(e, 'invoiceId')
  if (!invoiceId || !(await contabilidadActiva(sql, e.tenant_id))) return
  const [f] = await sql<{ numero: string }[]>`
    select supplier_invoice_number as numero from public.supplier_invoices
    where id = ${invoiceId} and tenant_id = ${e.tenant_id} and status = 'void'`
  if (!f) return
  const [hoy] = await sql<{ fecha: string }[]>`
    select (now() at time zone timezone)::date::text as fecha from regb.tenants where id = ${e.tenant_id}`
  await reversar(
    sql,
    e,
    {
      sourceType: 'ap_invoice',
      sourceId: invoiceId,
      asegurar: () => contabilizarFacturaProveedor(sql, e, invoiceId),
    },
    {
      sourceType: 'ap_invoice_void',
      fecha: hoy!.fecha,
      descripcion: `Anulacion de la factura de proveedor ${f.numero}`,
    },
  )
}

const pagoRegistrado: HandlerContable = async (e, sql) => {
  const paymentId = idDe(e, 'paymentId')
  if (!paymentId || !(await contabilidadActiva(sql, e.tenant_id))) return
  const [p] = await sql<
    { invoice_id: string; amount: string; method: string; fecha: string; numero: string }[]
  >`
    select p.invoice_id, p.amount::text, p.method,
           (p.paid_at at time zone t.timezone)::date::text as fecha,
           i.supplier_invoice_number as numero
    from public.supplier_payments p
    join public.supplier_invoices i on i.id = p.invoice_id
    join regb.tenants t on t.id = p.tenant_id
    where p.id = ${paymentId} and p.tenant_id = ${e.tenant_id}`
  if (!p) return
  // Mismo criterio que el cobro: el pago no entra sin su factura.
  await contabilizarFacturaProveedor(sql, e, p.invoice_id)
  await registrar(sql, e, {
    sourceType: 'ap_payment',
    sourceId: paymentId,
    fecha: p.fecha,
    descripcion: `Pago de la factura de proveedor ${p.numero}`,
    lineas: asientoPagoProveedor({ monto: p.amount, metodo: p.method }),
  })
}

/**
 * Tema -> handler contable. Lo mezcla el despachador con sus avisos: un
 * mismo tema (`pos.sale.completed`) puede tener los dos.
 */
export const HANDLERS_CONTABLES: Record<string, HandlerContable> = {
  'pos.sale.completed': ventaCajaCompletada,
  'pos.sale.voided': ventaCajaAnulada,
  'ar.invoice.issued': facturaClienteEmitida,
  'ar.invoice.voided': facturaClienteAnulada,
  'ar.payment.received': cobroRecibido,
  'ar.payment.reversed': cobroReversado,
  'ar.credit-note.issued': notaCreditoEmitida,
  'ar.late-fee.applied': cargoMoraAplicado,
  'ap.invoice.recorded': facturaProveedorRegistrada,
  'ap.invoice.voided': facturaProveedorAnulada,
  'ap.payment.recorded': pagoRegistrado,
}
