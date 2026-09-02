/**
 * Ordenes de compra — §5.4, modulo 45.
 *
 * Simetrico a fulfillment.ts (pedidos de venta) pero mas simple: no hay
 * reserva. Confirmar una orden de compra no toca inventario —es una
 * promesa del PROVEEDOR, no nuestra—, asi que solo existe un movimiento
 * de verdad: recibir. `qtyReceived` es lo unico que avanza.
 */

export type PurchaseOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'partially_received'
  | 'received'
  | 'cancelled'

export interface PurchaseLineState {
  qtyOrdered: number
  qtyReceived: number
}

/**
 * Deriva el estado de la orden de sus lineas. Igual que deriveOrderStatus:
 * es una FUNCION de las lineas, no un campo que se pisa a mano, para que
 * el encabezado no pueda mentir sobre lo que de verdad entro al almacen.
 *
 * `cancelled` no se deriva — es una decision humana y entra como parametro.
 */
export function deriveReceiptStatus(
  lines: PurchaseLineState[],
  cancelled = false,
): PurchaseOrderStatus {
  if (cancelled) return 'cancelled'
  if (lines.length === 0) return 'draft'

  const pedido = lines.reduce((a, l) => a + l.qtyOrdered, 0)
  const recibido = lines.reduce((a, l) => a + l.qtyReceived, 0)

  if (recibido >= pedido) return 'received'
  if (recibido > 0) return 'partially_received'
  return 'confirmed'
}

/** Lo que falta por recibir de una linea. Nunca negativo. */
export function pendingReceipt(line: PurchaseLineState): number {
  return Math.max(0, line.qtyOrdered - line.qtyReceived)
}

/**
 * Valida una recepcion antes de tocar la base: no se puede recibir mas de
 * lo pendiente. Vive aqui para que el servidor la use tal cual y la
 * pantalla pueda avisar antes de enviar (mismo patron que validateDelivery).
 */
export function validateReceipt(
  line: PurchaseLineState,
  qtyToReceive: number,
): { ok: true } | { ok: false; error: string } {
  if (qtyToReceive <= 0) {
    return { ok: false, error: 'La cantidad a recibir debe ser positiva.' }
  }
  const pendiente = pendingReceipt(line)
  if (qtyToReceive > pendiente) {
    return {
      ok: false,
      error: `Solo quedan ${pendiente} por recibir; se intento recibir ${qtyToReceive}.`,
    }
  }
  return { ok: true }
}

export interface VarianzaCosto {
  /** Positivo = llego mas caro de lo cotizado. */
  diferencia: number
  /** Fraccion sobre el costo cotizado. 0.1 = 10% mas caro. */
  porcentaje: number
}

/**
 * Compara el costo con el que se recibe contra el que se cotizo al pedir.
 *
 * No bloquea nada —un proveedor sube el precio y el almacen igual tiene
 * que recibir la mercancia—, pero es lo que le dice al comprador que el
 * proximo pedido hay que renegociarlo o buscar otro proveedor. Sin esto,
 * la diferencia se pierde en el costo promedio y nadie la nota hasta que
 * el margen ya bajo solo.
 */
export function costVariance(quotedCost: number, receivedCost: number): VarianzaCosto {
  const diferencia = receivedCost - quotedCost
  return {
    diferencia,
    porcentaje: quotedCost > 0 ? diferencia / quotedCost : 0,
  }
}
