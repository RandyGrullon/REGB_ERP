'use server'

import { revalidatePath } from 'next/cache'
import {
  deriveGoodsReceiptStatus,
  deriveReceiptStatus,
  pendingReceipt,
  qtyDisponibleParaDevolver,
  transicionValidaDevolucion,
  validateInspeccion,
  validateReceipt,
  type EstadoDevolucion,
  type PurchaseLineState,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'

/**
 * Acciones de recepciones (modulo 46, F8/S45).
 *
 * `registrarRecepcion()` agrupa varias lineas de un mismo camino en UN
 * documento: valida cada linea con `validateReceipt()`/`validateInspeccion()`
 * (@regb/operations, sin duplicar), postea el movimiento de inventario
 * SOLO por lo aceptado -lo rechazado no entra al on_hand, no hay
 * "cuarentena" en esta version-, y actualiza qty_received/estado de la
 * orden de compra con la misma logica que ya usa purchase-orders.
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

interface LineaEntrada {
  lineId: string
  qtyReceived: number
  qtyAccepted: number
  qtyRejected: number
  rejectionReason: string | null
  unitCost: number
}

function lineasDeFormulario(fd: FormData): LineaEntrada[] {
  const ids = fd.getAll('lineId').map(String)
  const recibido = fd.getAll('qtyReceived').map((v) => num(String(v)))
  const aceptado = fd.getAll('qtyAccepted').map((v) => num(String(v)))
  const rechazado = fd.getAll('qtyRejected').map((v) => num(String(v)))
  const razon = fd.getAll('rejectionReason').map((v) => String(v).trim() || null)
  const costo = fd.getAll('unitCost').map((v) => num(String(v)))

  return ids
    .map((lineId, i) => ({
      lineId,
      qtyReceived: recibido[i] ?? null,
      qtyAccepted: aceptado[i] ?? null,
      qtyRejected: rechazado[i] ?? null,
      rejectionReason: razon[i] ?? null,
      unitCost: costo[i] ?? null,
    }))
    .filter((l): l is LineaEntrada & { qtyReceived: number } => (l.qtyReceived ?? 0) > 0)
    .map((l) => ({
      lineId: l.lineId,
      qtyReceived: l.qtyReceived,
      qtyAccepted: l.qtyAccepted ?? l.qtyReceived,
      qtyRejected: l.qtyRejected ?? 0,
      rejectionReason: l.rejectionReason,
      unitCost: l.unitCost ?? 0,
    }))
}

/** Registra una recepcion completa: una o varias lineas, una sola transaccion. */
export async function registrarRecepcion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'receipts', 'receipts.receive')
  if (!permiso.ok) return permiso

  const orderId = String(fd.get('orderId') ?? '')
  const notes = String(fd.get('notes') ?? '').trim() || null
  if (!orderId) return { ok: false, error: 'Falta la orden de compra.' }

  const lineas = lineasDeFormulario(fd)
  if (lineas.length === 0) {
    return { ok: false, error: 'Escribe una cantidad recibida en al menos una linea.' }
  }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [order] = await tx<{ status: string; warehouse_id: string; supplier_id: string }[]>`
      select status, warehouse_id, supplier_id from public.purchase_orders
      where id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
    if (!order) return 'no-existe'
    if (order.status === 'draft') return 'sin-confirmar'
    if (order.status === 'cancelled') return 'cancelada'

    // goods_receipts es inmutable desde el insert -incluso para esta misma
    // transaccion-, asi que el status derivado tiene que quedar decidido
    // ANTES de insertar el encabezado, nunca como un update posterior:
    // primero se valida e inspecciona cada linea sin escribir nada, luego
    // se inserta el encabezado con el status final ya calculado.
    const preparadas: {
      lineId: string
      productId: string
      qtyExpected: number
      qtyReceived: number
      qtyAccepted: number
      qtyRejected: number
      rejectionReason: string | null
      unitCost: number
    }[] = []

    for (const l of lineas) {
      const [line] = await tx<
        { product_id: string; qty_ordered: string; qty_received: string }[]
      >`
        select product_id, qty_ordered::text, qty_received::text
        from public.purchase_order_lines
        where id = ${l.lineId} and order_id = ${orderId} and tenant_id = ${ctx.tenantId} for update`
      if (!line) throw new Error(`Esa linea no pertenece a esta orden.`)

      const estado: PurchaseLineState = {
        qtyOrdered: Number(line.qty_ordered),
        qtyReceived: Number(line.qty_received),
      }
      const checkRecepcion = validateReceipt(estado, l.qtyReceived)
      if (!checkRecepcion.ok) throw new Error(checkRecepcion.error)

      const checkInspeccion = validateInspeccion(l.qtyReceived, l.qtyAccepted, l.qtyRejected)
      if (!checkInspeccion.ok) throw new Error(checkInspeccion.error)

      if (l.qtyRejected > 0 && !l.rejectionReason) {
        throw new Error('Escribe la razon del rechazo cuando hay unidades rechazadas.')
      }

      preparadas.push({
        lineId: l.lineId,
        productId: line.product_id,
        qtyExpected: pendingReceipt(estado),
        qtyReceived: l.qtyReceived,
        qtyAccepted: l.qtyAccepted,
        qtyRejected: l.qtyRejected,
        rejectionReason: l.rejectionReason,
        unitCost: l.unitCost,
      })
    }

    const receiptStatus = deriveGoodsReceiptStatus(preparadas)

    const [receipt] = await tx<{ id: string }[]>`
      insert into public.goods_receipts
        (tenant_id, purchase_order_id, warehouse_id, supplier_id, received_by, notes, status)
      values (${ctx.tenantId}, ${orderId}, ${order.warehouse_id}, ${order.supplier_id},
              ${ctx.userId}, ${notes}, ${receiptStatus})
      returning id`
    const receiptId = receipt!.id

    for (const p of preparadas) {
      await tx`
        insert into public.goods_receipt_lines
          (receipt_id, tenant_id, purchase_order_line_id, product_id,
           qty_expected, qty_received, qty_accepted, qty_rejected, rejection_reason, unit_cost)
        values (${receiptId}, ${ctx.tenantId}, ${p.lineId}, ${p.productId},
                ${p.qtyExpected}, ${p.qtyReceived}, ${p.qtyAccepted}, ${p.qtyRejected},
                ${p.rejectionReason}, ${p.unitCost})`

      // Solo lo ACEPTADO entra al inventario vendible -lo rechazado no
      // pasa por una "cuarentena" en esta version, queda fuera del
      // on_hand hasta que se resuelva la devolucion-.
      if (p.qtyAccepted > 0) {
        await tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost,
             reference_type, reference_id, created_by)
          values (${ctx.tenantId}, ${order.warehouse_id}, ${p.productId},
                  'receipt', ${p.qtyAccepted}, ${p.unitCost}, 'goods_receipt', ${receiptId}, ${ctx.userId})`
      }

      await tx`
        update public.purchase_order_lines
        set qty_received = qty_received + ${p.qtyReceived}
        where id = ${p.lineId} and tenant_id = ${ctx.tenantId}`
    }

    const todasLasLineas = await tx<PurchaseLineState[]>`
      select qty_ordered::float8 as "qtyOrdered", qty_received::float8 as "qtyReceived"
      from public.purchase_order_lines where order_id = ${orderId} and tenant_id = ${ctx.tenantId}`
    const estadoOrden = deriveReceiptStatus(todasLasLineas)
    await tx`
      update public.purchase_orders set status = ${estadoOrden}, updated_at = now()
      where id = ${orderId} and tenant_id = ${ctx.tenantId}`

    await tx`
      select public.emit_event('receipts.receipt.registered',
        ${JSON.stringify({ orderId, receiptId })}::text::jsonb, 'receipts')`

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado === 'sin-confirmar') return { ok: false, error: 'Confirma la orden primero.' }
  if (resultado === 'cancelada') return { ok: false, error: 'La orden esta cancelada.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/recepciones/${orderId}`)
  revalidatePath('/recepciones')
  revalidatePath('/inventory')
  return { ok: true }
}

/** Registra una devolucion pendiente por unidades rechazadas en una linea. */
export async function registrarDevolucion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'receipts', 'receipts.return')
  if (!permiso.ok) return permiso

  const lineaId = String(fd.get('goodsReceiptLineId') ?? '')
  const qty = num(String(fd.get('qty') ?? ''))
  const reason = String(fd.get('reason') ?? '').trim()
  if (!lineaId) return { ok: false, error: 'Falta la linea de recepcion.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser mayor que cero.' }
  if (!reason) return { ok: false, error: 'Escribe la razon de la devolucion.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [linea] = await tx<{ qty_rejected: string; receipt_id: string }[]>`
      select qty_rejected::text, receipt_id from public.goods_receipt_lines
      where id = ${lineaId} and tenant_id = ${ctx.tenantId}`
    if (!linea) return 'sin-linea'

    const [receipt] = await tx<{ supplier_id: string }[]>`
      select supplier_id from public.goods_receipts where id = ${linea.receipt_id} and tenant_id = ${ctx.tenantId}`
    if (!receipt) return 'sin-linea'

    const [ya] = await tx<{ total: string }[]>`
      select coalesce(sum(qty), 0)::text as total from public.supplier_returns
      where goods_receipt_line_id = ${lineaId} and tenant_id = ${ctx.tenantId} and status != 'cancelled'`

    const disponible = qtyDisponibleParaDevolver(Number(linea.qty_rejected), Number(ya!.total))
    if (qty > disponible) {
      return `Solo hay ${disponible} unidades rechazadas disponibles para devolver.`
    }

    await tx`
      insert into public.supplier_returns
        (tenant_id, goods_receipt_line_id, supplier_id, qty, reason)
      values (${ctx.tenantId}, ${lineaId}, ${receipt.supplier_id}, ${qty}, ${reason})`

    return 'ok'
  })

  if (resultado === 'sin-linea') return { ok: false, error: 'Esa linea de recepcion no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/recepciones')
  return { ok: true }
}

async function resolverDevolucion(
  fd: FormData,
  siguiente: EstadoDevolucion,
): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'receipts', 'receipts.return')
  if (!permiso.ok) return permiso

  const devolucionId = String(fd.get('devolucionId') ?? '')
  if (!devolucionId) return { ok: false, error: 'Falta la devolucion.' }

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [d] = await tx<
      { status: string; qty: string; goods_receipt_line_id: string }[]
    >`
      select status, qty::text, goods_receipt_line_id from public.supplier_returns
      where id = ${devolucionId} and tenant_id = ${ctx.tenantId} for update`
    if (!d) return 'no-existe'
    if (!transicionValidaDevolucion(d.status as EstadoDevolucion, siguiente)) {
      return 'Esa devolucion ya fue resuelta.'
    }

    if (siguiente === 'sent') {
      const [linea] = await tx<{ product_id: string; unit_cost: string }[]>`
        select product_id, unit_cost::text from public.goods_receipt_lines
        where id = ${d.goods_receipt_line_id} and tenant_id = ${ctx.tenantId}`
      const [receipt] = await tx<{ warehouse_id: string }[]>`
        select gr.warehouse_id from public.goods_receipt_lines grl
        join public.goods_receipts gr on gr.id = grl.receipt_id
        where grl.id = ${d.goods_receipt_line_id} and grl.tenant_id = ${ctx.tenantId}`
      if (linea && receipt) {
        await tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost,
             reference_type, reference_id, created_by)
          values (${ctx.tenantId}, ${receipt.warehouse_id}, ${linea.product_id},
                  'return_to_supplier', ${-Number(d.qty)}, ${linea.unit_cost},
                  'supplier_return', ${devolucionId}, ${ctx.userId})`
      }
      await tx`
        update public.supplier_returns set status = 'sent', sent_at = now(), updated_at = now()
        where id = ${devolucionId} and tenant_id = ${ctx.tenantId}`
      await tx`
        select public.emit_event('receipts.return.sent',
          ${JSON.stringify({ devolucionId })}::text::jsonb, 'receipts')`
    } else {
      await tx`
        update public.supplier_returns set status = 'cancelled', updated_at = now()
        where id = ${devolucionId} and tenant_id = ${ctx.tenantId}`
    }

    return 'ok'
  })

  if (resultado === 'no-existe') return { ok: false, error: 'Esa devolucion no existe.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath('/recepciones')
  revalidatePath('/inventory')
  return { ok: true }
}

export async function enviarDevolucion(fd: FormData): Promise<ActionResult> {
  return resolverDevolucion(fd, 'sent')
}

export async function cancelarDevolucion(fd: FormData): Promise<ActionResult> {
  return resolverDevolucion(fd, 'cancelled')
}

// ── Versiones para <form action> ────────────────────────────────────────
export async function registrarRecepcionForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarRecepcion(fd), 'registrarRecepcion')
}
export async function registrarDevolucionForm(fd: FormData): Promise<void> {
  await anotarAviso(await registrarDevolucion(fd), 'registrarDevolucion')
}
export async function enviarDevolucionForm(fd: FormData): Promise<void> {
  await anotarAviso(await enviarDevolucion(fd), 'enviarDevolucion')
}
export async function cancelarDevolucionForm(fd: FormData): Promise<void> {
  await anotarAviso(await cancelarDevolucion(fd), 'cancelarDevolucion')
}
