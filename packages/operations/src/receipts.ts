/**
 * Recepciones — §5.4, modulo 46.
 *
 * `purchase-orders` (45) ya sabe recibir una linea a la vez -incrementa
 * `qty_received`, postea el movimiento de inventario, deriva el estado
 * de la orden-. `receipts` no reinventa eso: reutiliza `pendingReceipt`,
 * `validateReceipt` y `costVariance` de `./procurement.js` tal cual.
 *
 * Lo que agrega de verdad es lo que la orden de compra por si sola no
 * tiene: un documento de recepcion que agrupa varias lineas de un mismo
 * camion con quien recibio, INSPECCION real (cuanto se acepta contra
 * cuanto se rechaza, no solo "cuanto llego"), deteccion de discrepancia
 * contra lo esperado, y devolucion al proveedor de lo rechazado.
 */

// Nota: `pendingReceipt`, `validateReceipt` y `costVariance` (necesarias
// para registrar una recepcion) NO se reexportan aqui -ya salen del
// barrel de @regb/operations via procurement.js, reexportarlas de nuevo
// aqui chocaria con esa exportacion-. Quien registre una recepcion las
// importa directo de procurement.js.

// ── Discrepancias ─────────────────────────────────────────────────────

export type TipoDiscrepancia = 'ninguna' | 'faltante' | 'sobrante'

export interface Discrepancia {
  tipo: TipoDiscrepancia
  /** received - expected. Negativo = falto, positivo = sobro. */
  diferencia: number
}

/**
 * Compara lo que se esperaba recibir (lo pendiente de la orden en ese
 * momento) contra lo que de verdad llego en el camion. No bloquea nada
 * -el almacen igual recibe lo que llegue-, pero queda marcado para que
 * el comprador lo vea sin tener que comparar a mano dos numeros.
 */
export function detectarDiscrepancia(qtyExpected: number, qtyReceived: number): Discrepancia {
  const diferencia = qtyReceived - qtyExpected
  if (diferencia === 0) return { tipo: 'ninguna', diferencia }
  return { tipo: diferencia < 0 ? 'faltante' : 'sobrante', diferencia }
}

/**
 * Estado del documento de recepcion completo: si CUALQUIER linea tiene
 * discrepancia, el documento entero queda marcado -no se promedia ni se
 * esconde entre lineas sin problema-.
 */
export function deriveGoodsReceiptStatus(
  lines: { qtyExpected: number; qtyReceived: number }[],
): 'completed' | 'with_discrepancies' {
  const hayDiscrepancia = lines.some(
    (l) => detectarDiscrepancia(l.qtyExpected, l.qtyReceived).tipo !== 'ninguna',
  )
  return hayDiscrepancia ? 'with_discrepancies' : 'completed'
}

// ── Inspeccion ────────────────────────────────────────────────────────

/** Las cantidades se guardan con 3 decimales (numeric(14,3)): se compara igual. */
const milesimas = (n: number): number => Math.round(n * 1000)

/**
 * Lo aceptado cuando el almacenista no lo escribe: lo que llego menos lo
 * que rechazo. Antes la pantalla precargaba "Aceptado" con lo PEDIDO, y
 * recibir 30 de 50 sin tocar ese campo reventaba la accion (50 + 0 no
 * suma 30). Recibir menos de lo pedido es el caso normal de una
 * recepcion parcial, no un error de captura.
 */
export function aceptadoPorDefecto(qtyReceived: number, qtyRejected: number): number {
  return milesimas(qtyReceived - qtyRejected) / 1000
}

/**
 * Lo aceptado mas lo rechazado tiene que sumar exactamente lo recibido
 * -no puede desaparecer unidades entre la inspeccion y el registro-.
 */
export function validateInspeccion(
  qtyReceived: number,
  qtyAccepted: number,
  qtyRejected: number,
): { ok: true } | { ok: false; error: string } {
  if (qtyAccepted < 0 || qtyRejected < 0) {
    return { ok: false, error: 'Las cantidades de inspeccion no pueden ser negativas.' }
  }
  if (milesimas(qtyAccepted) + milesimas(qtyRejected) !== milesimas(qtyReceived)) {
    return {
      ok: false,
      error: `Aceptado (${qtyAccepted}) + rechazado (${qtyRejected}) debe sumar lo recibido (${qtyReceived}).`,
    }
  }
  return { ok: true }
}

// ── Devolucion al proveedor ───────────────────────────────────────────

export type EstadoDevolucion = 'pending' | 'sent' | 'cancelled'

const TRANSICIONES_DEVOLUCION: Record<EstadoDevolucion, EstadoDevolucion[]> = {
  pending: ['sent', 'cancelled'],
  sent: [],
  cancelled: [],
}

/** Solo `pending` se mueve; `sent` y `cancelled` son terminales. */
export function transicionValidaDevolucion(
  actual: EstadoDevolucion,
  siguiente: EstadoDevolucion,
): boolean {
  return TRANSICIONES_DEVOLUCION[actual].includes(siguiente)
}

/**
 * De donde sale lo que se devuelve, y por eso si mueve inventario:
 *
 *  - `rejected`: lo que se rechazo en la inspeccion. NUNCA entro al
 *    on_hand (solo lo aceptado entra), asi que devolverlo no puede
 *    restar existencia: se despacha y se documenta, sin kardex.
 *  - `accepted`: algo que se acepto, entro al inventario, y despues
 *    aparecio malo. Ese si sale del almacen, y solo hasta lo aceptado.
 *
 * Antes toda devolucion restaba existencia -tambien la de lo rechazado-,
 * y el almacen terminaba con menos de lo que tenia en el estante
 * (hallazgo 11 del analisis de flujo: CEM-100 de 55 a 50).
 */
export type OrigenDevolucion = 'rejected' | 'accepted'

export function devolucionMueveInventario(origen: OrigenDevolucion): boolean {
  return origen === 'accepted'
}

/**
 * Cuanto queda disponible para devolver de una linea, para UN origen:
 * lo rechazado (o lo aceptado) menos lo que ya se registro en
 * devoluciones previas de ese mismo origen -sin contar las canceladas-.
 * Nunca negativo.
 */
export function qtyDisponibleParaDevolver(qtyBase: number, qtyYaDevuelta: number): number {
  return Math.max(0, milesimas(qtyBase - qtyYaDevuelta) / 1000)
}
