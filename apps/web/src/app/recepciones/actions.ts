'use server'

import { revalidatePath } from 'next/cache'
import {
  aceptadoPorDefecto,
  costoNetoUnitario,
  deriveGoodsReceiptStatus,
  deriveReceiptStatus,
  devolucionMueveInventario,
  pendingReceipt,
  qtyDisponibleParaDevolver,
  transicionValidaDevolucion,
  validateInspeccion,
  validateReceipt,
  type EstadoDevolucion,
  type OrigenDevolucion,
  type PurchaseLineState,
} from '@regb/operations'
import { asUser } from '@/lib/db'
import { anotarAviso } from '@/lib/aviso'
import { actionCtx, exigir, type ActionResult, type DemoParams } from '@/lib/module-page'
import { puedeVerCostoDeCompra } from './costo'

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

/**
 * Lo que la base rechace (un trigger, una restriccion, un id mal formado)
 * vuelve como texto para la pantalla, nunca como excepcion: una accion que
 * lanza tumba la pagina y el usuario pierde lo que escribio.
 */
const errorLegible = (e: unknown): string =>
  (e instanceof Error ? e.message : 'Error inesperado').replace(/^.*ERROR:\s*/, '')

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
  /** null = no lo escribieron: se usa el costo neto (cotizado menos descuento) de la orden. */
  unitCost: number | null
}

/**
 * Lee las lineas del formulario. Lo que el almacenista deja en blanco se
 * completa con lo razonable, no con lo que haria fallar la recepcion:
 *
 *  - "Aceptado" en blanco = recibido - rechazado (aceptadoPorDefecto).
 *    Antes la pantalla lo precargaba con lo PEDIDO, y recibir 30 de 50
 *    sin tocarlo hacia `throw` y tumbaba la pagina.
 *  - "Costo real" en blanco = el neto de la orden (cotizado menos el
 *    descuento del proveedor). Antes era 0 y hundia el costo promedio de
 *    todo el inventario de ese producto.
 */
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
    .filter((l): l is typeof l & { qtyReceived: number } => (l.qtyReceived ?? 0) > 0)
    .map((l) => {
      const qtyRejected = l.qtyRejected ?? 0
      return {
        lineId: l.lineId,
        qtyReceived: l.qtyReceived,
        qtyAccepted: l.qtyAccepted ?? aceptadoPorDefecto(l.qtyReceived, qtyRejected),
        qtyRejected,
        rejectionReason: l.rejectionReason,
        unitCost: l.unitCost,
      }
    })
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

  // Quien no ve costos (el almacenista, sin `inventory.cost.view`) no los
  // escribe: la pantalla no le pinta la columna, y si el formulario trae
  // un costo igual -a mano, por la consola- se ignora y entra el neto de
  // la orden. Si no, el rol que no puede VER el costo podria FIJARLO.
  const veCosto = puedeVerCostoDeCompra(ctx)
  const lineas = lineasDeFormulario(fd).map((l) => (veCosto ? l : { ...l, unitCost: null }))
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

    // Un error de captura se DEVUELVE como texto, nunca `throw`: una
    // excepcion dentro de la accion la convierte la pagina en el error
    // generico de Next y el almacenista pierde todo lo que escribio. Nada
    // se escribe hasta que todas las lineas pasan (ver el insert de abajo),
    // asi que salir aqui no deja nada a medias.
    for (const l of lineas) {
      const [line] = await tx<
        {
          product_id: string
          name: string
          qty_ordered: string
          qty_received: string
          unit_cost: string
          discount_pct: string
        }[]
      >`
        select l.product_id, p.name, l.qty_ordered::text, l.qty_received::text, l.unit_cost::text,
               l.discount_pct::text
        from public.purchase_order_lines l
        join public.products p on p.id = l.product_id
        where l.id = ${l.lineId} and l.order_id = ${orderId} and l.tenant_id = ${ctx.tenantId}
        for update of l`
      if (!line) return 'Esa linea no pertenece a esta orden.'

      const estado: PurchaseLineState = {
        qtyOrdered: Number(line.qty_ordered),
        qtyReceived: Number(line.qty_received),
      }
      const checkRecepcion = validateReceipt(estado, l.qtyReceived)
      if (!checkRecepcion.ok) return `${line.name}: ${checkRecepcion.error}`

      const checkInspeccion = validateInspeccion(l.qtyReceived, l.qtyAccepted, l.qtyRejected)
      if (!checkInspeccion.ok) return `${line.name}: ${checkInspeccion.error}`

      if (l.qtyRejected > 0 && !l.rejectionReason) {
        return `${line.name}: escribe la razon del rechazo cuando hay unidades rechazadas.`
      }
      if (l.unitCost !== null && l.unitCost < 0) {
        return `${line.name}: el costo no puede ser negativo.`
      }

      preparadas.push({
        lineId: l.lineId,
        productId: line.product_id,
        qtyExpected: pendingReceipt(estado),
        qtyReceived: l.qtyReceived,
        qtyAccepted: l.qtyAccepted,
        qtyRejected: l.qtyRejected,
        rejectionReason: l.rejectionReason,
        // En blanco = lo que de verdad se pacto: el cotizado MENOS el
        // descuento del proveedor. El bruto inflaba el costo promedio.
        unitCost:
          l.unitCost ?? costoNetoUnitario(Number(line.unit_cost), Number(line.discount_pct)),
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
  }).catch(errorLegible)

  if (resultado === 'no-existe') return { ok: false, error: 'Esa orden no existe.' }
  if (resultado === 'sin-confirmar') return { ok: false, error: 'Confirma la orden primero.' }
  if (resultado === 'cancelada') return { ok: false, error: 'La orden esta cancelada.' }
  if (resultado !== 'ok') return { ok: false, error: resultado }

  revalidatePath(`/recepciones/${orderId}`)
  revalidatePath('/recepciones')
  revalidatePath('/inventory')
  return { ok: true }
}

/**
 * Registra una devolucion pendiente de una linea de recepcion.
 *
 * `origin` dice de donde sale lo devuelto (ver `OrigenDevolucion`):
 *  - `rejected` (por defecto): lo rechazado en la inspeccion. Nunca entro
 *    al inventario; el tope es lo rechazado.
 *  - `accepted`: algo aceptado que salio malo despues. Si entro, y al
 *    enviarse sale del almacen; el tope es lo aceptado.
 * El tope se comprueba aqui (para el mensaje) y en la base
 * (`limitar_devolucion`, 0131), que es la que no se puede saltar.
 */
export async function registrarDevolucion(fd: FormData): Promise<ActionResult> {
  const ctx = await actionCtx(demoDe(fd))
  if (!ctx) return { ok: false, error: 'Sesion no valida.' }
  const permiso = exigir(ctx, 'receipts', 'receipts.return')
  if (!permiso.ok) return permiso

  const lineaId = String(fd.get('goodsReceiptLineId') ?? '')
  const qty = num(String(fd.get('qty') ?? ''))
  const reason = String(fd.get('reason') ?? '').trim()
  const origenRaw = String(fd.get('origin') ?? '').trim() || 'rejected'
  if (!lineaId) return { ok: false, error: 'Falta la linea de recepcion.' }
  if (qty === null || qty <= 0) return { ok: false, error: 'La cantidad debe ser mayor que cero.' }
  if (!reason) return { ok: false, error: 'Escribe la razon de la devolucion.' }
  if (origenRaw !== 'rejected' && origenRaw !== 'accepted') {
    return { ok: false, error: 'Elige si devuelves lo rechazado o algo ya aceptado.' }
  }
  const origen: OrigenDevolucion = origenRaw

  const resultado = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    // `for update`: dos devoluciones de la misma linea a la vez no pasan
    // las dos el mismo cupo. La linea es inmutable; el candado no la edita.
    const [linea] = await tx<{ qty_rejected: string; qty_accepted: string; receipt_id: string }[]>`
      select qty_rejected::text, qty_accepted::text, receipt_id from public.goods_receipt_lines
      where id = ${lineaId} and tenant_id = ${ctx.tenantId} for update`
    if (!linea) return 'sin-linea'

    const [receipt] = await tx<{ supplier_id: string }[]>`
      select supplier_id from public.goods_receipts where id = ${linea.receipt_id} and tenant_id = ${ctx.tenantId}`
    if (!receipt) return 'sin-linea'

    const [ya] = await tx<{ total: string }[]>`
      select coalesce(sum(qty), 0)::text as total from public.supplier_returns
      where goods_receipt_line_id = ${lineaId} and tenant_id = ${ctx.tenantId}
        and origin = ${origen} and status != 'cancelled'`

    const base = Number(origen === 'accepted' ? linea.qty_accepted : linea.qty_rejected)
    const disponible = qtyDisponibleParaDevolver(base, Number(ya!.total))
    if (qty > disponible) {
      const que = origen === 'accepted' ? 'aceptadas' : 'rechazadas'
      return `Solo hay ${disponible} unidades ${que} disponibles para devolver.`
    }

    await tx`
      insert into public.supplier_returns
        (tenant_id, goods_receipt_line_id, supplier_id, qty, reason, origin)
      values (${ctx.tenantId}, ${lineaId}, ${receipt.supplier_id}, ${qty}, ${reason}, ${origen})`

    return 'ok'
  }).catch(errorLegible)

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
      { status: string; qty: string; goods_receipt_line_id: string; origin: OrigenDevolucion }[]
    >`
      select status, qty::text, goods_receipt_line_id, origin from public.supplier_returns
      where id = ${devolucionId} and tenant_id = ${ctx.tenantId} for update`
    if (!d) return 'no-existe'
    if (!transicionValidaDevolucion(d.status as EstadoDevolucion, siguiente)) {
      return 'Esa devolucion ya fue resuelta.'
    }

    if (siguiente === 'sent') {
      // Solo sale del almacen lo que entro al almacen. Lo rechazado nunca
      // entro al on_hand (registrarRecepcion solo postea lo aceptado): un
      // movimiento de salida aqui restaba existencia que no existia
      // (hallazgo 11 del analisis de flujo).
      if (devolucionMueveInventario(d.origin)) {
        const [linea] = await tx<{ product_id: string; unit_cost: string; warehouse_id: string }[]>`
          select grl.product_id, grl.unit_cost::text, gr.warehouse_id
          from public.goods_receipt_lines grl
          join public.goods_receipts gr on gr.id = grl.receipt_id
          where grl.id = ${d.goods_receipt_line_id} and grl.tenant_id = ${ctx.tenantId}`
        if (!linea) return 'Esa devolucion no tiene su linea de recepcion.'
        await tx`
          insert into public.inventory_movements
            (tenant_id, warehouse_id, product_id, movement_type, qty, unit_cost,
             reference_type, reference_id, created_by)
          values (${ctx.tenantId}, ${linea.warehouse_id}, ${linea.product_id},
                  'return_to_supplier', ${-Number(d.qty)}, ${linea.unit_cost},
                  'supplier_return', ${devolucionId}, ${ctx.userId})`
      }
      await tx`
        update public.supplier_returns set status = 'sent', sent_at = now(), updated_at = now()
        where id = ${devolucionId} and tenant_id = ${ctx.tenantId}`
      await tx`
        select public.emit_event('receipts.return.sent',
          ${JSON.stringify({ devolucionId, origin: d.origin })}::text::jsonb, 'receipts')`
    } else {
      await tx`
        update public.supplier_returns set status = 'cancelled', updated_at = now()
        where id = ${devolucionId} and tenant_id = ${ctx.tenantId}`
    }

    return 'ok'
  }).catch(errorLegible)

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
