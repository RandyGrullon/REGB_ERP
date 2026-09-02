'use server'

import { revalidatePath } from 'next/cache'
import {
  deriveReceiptStatus,
  documentTotals,
  isValidTaxId,
  lineTotals,
  normalizeTaxId,
  validateReceipt,
  type PurchaseLineState,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de compras (modulo 45, §5.4).
 *
 * CONFIRMAR NO MUEVE INVENTARIO. Al reves que un pedido de venta, una
 * orden de compra confirmada es una promesa del PROVEEDOR, no nuestra: no
 * hay nada que apartar. RECIBIR es el unico momento que entra mercancia,
 * y ahi el almacenista cuenta lo fisico que llego — que puede ser distinto
 * de lo pedido, y el sistema lo deja declarar as viene, no lo que deberia.
 */

function demoDe(fd: FormData): DemoParams {
  return {
    tenant: String(fd.get('tenant') ?? '') || undefined,
    rol: String(fd.get('rol') ?? '') || undefined,
  }
}

const num = (raw: string): number | null => {
  const t = raw.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ── Proveedores ──────────────────────────────────────────────────────────

export async function crearProveedor(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'purchase-orders', 'purchase-orders.suppliers.manage')
  if (!permiso.ok) return permiso

  const name = String(fd.get('name') ?? '').trim()
  const taxIdRaw = String(fd.get('taxId') ?? '').trim()
  const phone = String(fd.get('phone') ?? '').trim() || null
  const email = String(fd.get('email') ?? '').trim() || null
  const terms = num(String(fd.get('terms') ?? '0')) ?? 0

  if (name.length < 2) return { ok: false, error: 'El nombre necesita al menos 2 letras.' }
  if (terms < 0) return { ok: false, error: 'Los dias de credito no pueden ser negativos.' }

  // Mismo motivo que con los clientes (0021/pedidos): un RNC mal tecleado
  // no se nota al guardarlo, se nota el dia que haga falta declarar el
  // 606 y el proveedor no exista en la DGII con ese numero.
  const taxId = taxIdRaw === '' ? null : normalizeTaxId(taxIdRaw)
  if (taxId !== null && !isValidTaxId(taxId)) {
    return {
      ok: false,
      error: `"${taxIdRaw}" no es un RNC ni una cedula valida: el digito verificador no cuadra.`,
    }
  }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      insert into public.suppliers (tenant_id, name, tax_id, phone, email, payment_terms)
      values (${ctx.tenantId}, ${name}, ${taxId}, ${phone}, ${email}, ${terms})`
  })

  revalidatePath('/compras/proveedores')
  return { ok: true }
}

export async function alternarProveedor(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'purchase-orders', 'purchase-orders.suppliers.manage')
  if (!permiso.ok) return permiso

  const id = String(fd.get('id') ?? '')
  if (!id) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, (tx) => {
    return tx`
      update public.suppliers set is_active = not is_active, updated_at = now()
      where id = ${id} and tenant_id = ${ctx.tenantId}`
  })

  revalidatePath('/compras/proveedores')
  return { ok: true }
}

// ── Ordenes de compra ────────────────────────────────────────────────────

/** Crea la orden en borrador. Las lineas se agregan despues. */
export async function crearOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'purchase-orders', 'purchase-orders.create')
  if (!permiso.ok) return permiso

  const supplierId = String(fd.get('supplierId') ?? '')
  const warehouseId = String(fd.get('warehouseId') ?? '')
  if (!supplierId || !warehouseId) return { ok: false, error: 'Elige proveedor y almacen.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [n] = await tx<{ next_purchase_order_number: string }[]>`
      select public.next_purchase_order_number(${ctx.tenantId})`
    await tx`
      insert into public.purchase_orders
        (tenant_id, number, supplier_id, warehouse_id, created_by)
      values (${ctx.tenantId}, ${n!.next_purchase_order_number}, ${supplierId},
              ${warehouseId}, ${ctx.userId})`
  })

  revalidatePath('/compras')
  return { ok: true }
}

/** Recalcula totales del encabezado a partir de sus lineas. */
async function recalcular(
  tx: Parameters<Parameters<typeof asUser>[2]>[0],
  tenantId: string,
  orderId: string,
): Promise<void> {
  const lines = await tx<
    { qty_ordered: string; unit_cost: string; discount_pct: string; tax_rate: string }[]
  >`
    select qty_ordered::text, unit_cost::text, discount_pct::text, tax_rate::text
    from public.purchase_order_lines
    where order_id = ${orderId} and tenant_id = ${tenantId}`

  // Mismo motor de totales que pedidos de venta (§8.3): `tax_rate` en
  // FRACCION, cero formulas duplicadas.
  const totales = documentTotals(
    lines.map((l) => ({
      quantity: Number(l.qty_ordered),
      unitPrice: Number(l.unit_cost),
      discountPct: Number(l.discount_pct),
      taxRate: Number(l.tax_rate),
    })),
  )

  await tx`
    update public.purchase_orders
    set subtotal = ${totales.subtotal}, discount = ${totales.discount},
        tax = ${totales.tax}, total = ${totales.total}, updated_at = now()
    where id = ${orderId} and tenant_id = ${tenantId}`
}

export async function agregarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'purchase-orders', 'purchase-orders.edit')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const productId = String(fd.get('productId') ?? '')
  const qty = num(String(fd.get('qty') ?? ''))
  const costo = num(String(fd.get('unitCost') ?? ''))
  const descuento = num(String(fd.get('discountPct') ?? '0')) ?? 0

  if (!orderId || !productId) return { ok: false, error: 'Faltan datos.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser positiva.' }
  if (costo === null || costo < 0) return { ok: false, error: 'El costo no puede ser negativo.' }
  if (descuento < 0 || descuento > 100) return { ok: false, error: 'El descuento va de 0 a 100.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string }[]>`
      select status from public.purchase_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (!order) return 'no-existe'
    if (order.status !== 'draft') return 'no-borrador'

    const [p] = await tx<{ tax_rate: string }[]>`
      select tax_rate::text from public.products
      where id = ${productId} and tenant_id = ${ctx.tenantId}`
    if (!p) return 'sin-producto'

    // El costo lo escribe quien compra, NO sale del catalogo: el catalogo
    // guarda el costo de la ULTIMA compra, y esta es la compra que lo va
    // a fijar. Usar el viejo aqui seria mentirle al comprador sobre lo
    // que esta cotizando ahora mismo.
    const totals = lineTotals({
      quantity: qty,
      unitPrice: costo,
      discountPct: descuento,
      taxRate: Number(p.tax_rate),
    })

    await tx`
      insert into public.purchase_order_lines
        (order_id, tenant_id, product_id, qty_ordered, unit_cost, discount_pct, tax_rate, line_total)
      values (${orderId}, ${ctx.tenantId}, ${productId}, ${qty}, ${costo},
              ${descuento}, ${p.tax_rate}, ${totals.total})`

    await recalcular(tx, ctx.tenantId, orderId)
    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado === 'no-borrador') {
    return { ok: false, error: 'Solo se pueden agregar lineas a una orden en borrador.' }
  }
  if (resultado === 'sin-producto') return { ok: false, error: 'Ese producto no existe.' }

  revalidatePath(`/compras/${orderId}`)
  return { ok: true }
}

export async function quitarLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'purchase-orders', 'purchase-orders.edit')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const lineId = String(fd.get('lineId') ?? '')
  if (!orderId || !lineId) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string }[]>`
      select status from public.purchase_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (order?.status !== 'draft') return
    await tx`
      delete from public.purchase_order_lines
      where id = ${lineId} and tenant_id = ${ctx.tenantId}`
    await recalcular(tx, ctx.tenantId, orderId)
  })

  revalidatePath(`/compras/${orderId}`)
  return { ok: true }
}

/**
 * Confirma la orden. NO toca inventario — es la promesa del proveedor.
 */
export async function confirmarOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'purchase-orders', 'purchase-orders.confirm')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Faltan datos.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; total: string }[]>`
      select status, total::text from public.purchase_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!order) return 'no-existe'
    if (order.status !== 'draft') return 'no-borrador'

    const [lineas] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.purchase_order_lines
      where order_id = ${orderId} and tenant_id = ${ctx.tenantId}`
    if (Number(lineas?.n ?? 0) === 0) return 'sin-lineas'

    await tx`
      update public.purchase_orders
      set status = 'confirmed', confirmed_at = now(), updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('purchase-orders.order.confirmed',
        ${JSON.stringify({ orderId, total: Number(order.total) })}::text::jsonb, 'purchase-orders')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado === 'no-borrador') return { ok: false, error: 'Esta orden ya fue confirmada.' }
  if (resultado === 'sin-lineas') {
    return { ok: false, error: 'Agrega al menos una linea antes de confirmar.' }
  }

  revalidatePath(`/compras/${orderId}`)
  revalidatePath('/compras')
  return { ok: true }
}

/**
 * Recibe una linea: entra mercancia AL ALMACEN con el costo real que
 * declara quien recibe, no el que se cotizo al pedir.
 *
 * El movimiento 'receipt' lo procesa el MISMO trigger de 0019 que ya usan
 * los ajustes de inventario (apply_inventory_movement): promedio
 * ponderado movil, sin tocar una linea de ese codigo.
 */
export async function recibirLinea(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'purchase-orders', 'purchase-orders.receive')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const lineId = String(fd.get('lineId') ?? '')
  const qty = num(String(fd.get('qty') ?? ''))
  const costoRecibidoRaw = String(fd.get('unitCost') ?? '').trim()
  if (!orderId || !lineId) return { ok: false, error: 'Faltan datos.' }
  if (qty === null) return { ok: false, error: 'Cantidad no valida.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; warehouse_id: string }[]>`
      select status, warehouse_id from public.purchase_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!order) return 'no-existe'
    if (order.status === 'draft') return 'sin-confirmar'
    if (order.status === 'cancelled') return 'cancelada'

    const [line] = await tx<
      { product_id: string; qty_ordered: string; qty_received: string; unit_cost: string }[]
    >`
      select product_id, qty_ordered::text, qty_received::text, unit_cost::text
      from public.purchase_order_lines
      where id = ${lineId} and tenant_id = ${ctx.tenantId}`
    if (!line) return 'sin-linea'

    const estado: PurchaseLineState = {
      qtyOrdered: Number(line.qty_ordered),
      qtyReceived: Number(line.qty_received),
    }
    const check = validateReceipt(estado, qty)
    if (!check.ok) return check.error

    // Si quien recibe no escribe un costo distinto, se usa el cotizado.
    // El proveedor puede subir o bajar el precio en la entrega real, y el
    // sistema no lo bloquea: bloquear una recepcion por eso dejaria la
    // mercancia parada en el muelle.
    const costoRecibido = costoRecibidoRaw === '' ? Number(line.unit_cost) : Number(costoRecibidoRaw)
    if (!Number.isFinite(costoRecibido) || costoRecibido < 0) {
      return 'El costo de recepcion no es valido.'
    }

    await tx`
      insert into public.inventory_movements
        (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost,
         reference_type, reference_id, created_by)
      values (${ctx.tenantId}, ${order.warehouse_id}, ${line.product_id},
              'receipt', ${qty}, ${costoRecibido}, 'purchase_order', ${orderId}, ${ctx.userId})`

    await tx`
      update public.purchase_order_lines
      set qty_received = qty_received + ${qty}
      where id = ${lineId} and tenant_id = ${ctx.tenantId}`

    const nuevo = await tx<PurchaseLineState[]>`
      select qty_ordered::float8 as "qtyOrdered", qty_received::float8 as "qtyReceived"
      from public.purchase_order_lines where order_id = ${orderId} and tenant_id = ${ctx.tenantId}`

    const estadoOrden = deriveReceiptStatus(nuevo)
    await tx`
      update public.purchase_orders set status = ${estadoOrden}, updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('purchase-orders.receipt.posted',
        ${JSON.stringify({ orderId, productId: line.product_id, qty })}::text::jsonb,
        'purchase-orders')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado === 'sin-confirmar') return { ok: false, error: 'Confirma la orden primero.' }
  if (resultado === 'cancelada') return { ok: false, error: 'La orden esta cancelada.' }
  if (resultado === 'sin-linea') return { ok: false, error: 'Esa linea no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/compras/${orderId}`)
  revalidatePath('/inventory')
  return { ok: true }
}

export async function cancelarOrden(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'purchase-orders', 'purchase-orders.cancel')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  if (!orderId) return { ok: false, error: 'Faltan datos.' }

  await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string }[]>`
      select status from public.purchase_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    // Lo ya recibido no se revierte, igual que un pedido de venta ya
    // entregado: la mercancia que entro al almacen entro de verdad.
    if (!order || order.status === 'cancelled') return

    await tx`
      update public.purchase_orders
      set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('purchase-orders.order.cancelled',
        ${JSON.stringify({ orderId })}::text::jsonb, 'purchase-orders')`
  })

  revalidatePath(`/compras/${orderId}`)
  revalidatePath('/compras')
  return { ok: true }
}

// ── Envoltorios para <form action> ─────────────────────────────────────
export async function crearProveedorForm(fd: FormData): Promise<void> {
  await crearProveedor(fd)
}
export async function alternarProveedorForm(fd: FormData): Promise<void> {
  await alternarProveedor(fd)
}
export async function crearOrdenForm(fd: FormData): Promise<void> {
  await crearOrden(fd)
}
export async function agregarLineaForm(fd: FormData): Promise<void> {
  await agregarLinea(fd)
}
export async function quitarLineaForm(fd: FormData): Promise<void> {
  await quitarLinea(fd)
}
export async function confirmarOrdenForm(fd: FormData): Promise<void> {
  await confirmarOrden(fd)
}
export async function recibirLineaForm(fd: FormData): Promise<void> {
  await recibirLinea(fd)
}
export async function cancelarOrdenForm(fd: FormData): Promise<void> {
  await cancelarOrden(fd)
}
