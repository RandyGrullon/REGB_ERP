/**
 * Reserva de stock y estado de un pedido — §5.3, modulo 32.
 *
 * Reservar no mueve existencia: aparta unidades que siguen en el almacen pero
 * ya tienen dueno. Entregar es lo que las saca. Por eso un pedido confirmado
 * baja la DISPONIBILIDAD sin tocar el fisico, y el conteo del almacenista
 * sigue cuadrando.
 */

export interface FulfillmentPlan {
  /** Unidades que se pueden apartar ahora. */
  toReserve: number
  /** Unidades que quedan debiendo: no hay existencia. */
  backordered: number
}

/**
 * Reparte lo pedido entre lo que hay y lo que falta. Reserva parcial
 * permitida: es preferible apartar 8 de 10 y avisar por 2, a rechazar el
 * pedido entero — asi opera un mostrador de verdad.
 */
export function planFulfillment(qtyOrdered: number, qtyAvailable: number): FulfillmentPlan {
  if (qtyOrdered <= 0) {
    throw new Error(`La cantidad pedida debe ser positiva; se recibio ${qtyOrdered}`)
  }
  const disponible = Math.max(0, qtyAvailable)
  const toReserve = Math.min(qtyOrdered, disponible)
  return { toReserve, backordered: qtyOrdered - toReserve }
}

export type OrderStatus = 'draft' | 'confirmed' | 'partially_delivered' | 'delivered' | 'cancelled'

export interface OrderLineState {
  qtyOrdered: number
  qtyReserved: number
  qtyDelivered: number
}

/**
 * Deriva el estado del pedido de sus lineas. Es una FUNCION de las lineas, no
 * un campo que se va pisando a mano: asi el encabezado no puede mentir sobre
 * lo que realmente se entrego.
 *
 * `cancelled` no se deriva — es una decision humana y entra como parametro.
 */
export function deriveOrderStatus(lines: OrderLineState[], cancelled = false): OrderStatus {
  if (cancelled) return 'cancelled'
  if (lines.length === 0) return 'draft'

  const pedido = lines.reduce((a, l) => a + l.qtyOrdered, 0)
  const entregado = lines.reduce((a, l) => a + l.qtyDelivered, 0)
  const reservado = lines.reduce((a, l) => a + l.qtyReserved, 0)

  if (entregado >= pedido) return 'delivered'
  if (entregado > 0) return 'partially_delivered'
  if (reservado > 0) return 'confirmed'
  return 'draft'
}

/** Un pedido esta en backorder mientras alguna linea no tenga todo apartado ni entregado. */
export function hasBackorder(lines: OrderLineState[]): boolean {
  return lines.some((l) => l.qtyReserved + l.qtyDelivered < l.qtyOrdered)
}

/** Lo que falta por entregar de una linea. Nunca negativo. */
export function pendingDelivery(line: OrderLineState): number {
  return Math.max(0, line.qtyOrdered - line.qtyDelivered)
}

/**
 * Valida una entrega antes de tocar la base: no se puede entregar mas de lo
 * pendiente. La comprobacion vive aqui para que el servidor la use tal cual y
 * la pantalla pueda avisar antes de enviar.
 */
export function validateDelivery(
  line: OrderLineState,
  qtyToDeliver: number,
): { ok: true } | { ok: false; error: string } {
  if (qtyToDeliver <= 0) {
    return { ok: false, error: 'La cantidad a entregar debe ser positiva.' }
  }
  const pendiente = pendingDelivery(line)
  if (qtyToDeliver > pendiente) {
    return {
      ok: false,
      error: `Solo quedan ${pendiente} por entregar; se intento entregar ${qtyToDeliver}.`,
    }
  }
  return { ok: true }
}
