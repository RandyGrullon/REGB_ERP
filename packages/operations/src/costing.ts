import { roundBankers } from '@regb/core'

/**
 * Costeo de inventario — promedio ponderado movil.
 *
 * Por que promedio y no FIFO: FIFO de verdad exige capas de lotes (saber de
 * cual entrada sale cada unidad), y eso es exactamente lo que construye
 * `lots-serials` en F8. Media implementacion hoy seria una tabla desechable.
 * Ademas el promedio ponderado es lo que usa el comercio dominicano pequeno
 * y lo que su contador espera ver (§5.4, modulo 48).
 *
 * El costo se guarda con 4 decimales, no 2: un producto que entra a $0.3333
 * la unidad, redondeado a $0.33, desvia la valorizacion de un almacen con
 * cien mil unidades en cientos de pesos. Solo se redondea a 2 al PRESENTAR
 * un monto, nunca al acumular.
 */

export const COST_DECIMALS = 4

export interface StockPosition {
  /** Unidades disponibles fisicamente. Puede ser negativo si se permite sobreventa. */
  qtyOnHand: number
  /** Costo unitario promedio vigente. */
  avgCost: number
}

/**
 * Aplica una ENTRADA (compra, devolucion de cliente, ajuste positivo) y
 * devuelve la nueva posicion.
 *
 * Formula: `nuevo = (qty_actual x costo_actual + qty_entra x costo_entra) / total`
 *
 * Casos que no son obvios:
 *  - Con existencia en cero, el promedio es simplemente el costo de entrada.
 *  - Con existencia NEGATIVA (se vendio lo que no habia), promediar daria un
 *    resultado sin sentido — se adopta el costo de la entrada, que es el unico
 *    dato real que tenemos.
 *  - Una entrada sin costo declarado (`null`) no altera el promedio: es una
 *    devolucion o un ajuste de cantidad, no una compra.
 */
export function applyInbound(
  current: StockPosition,
  qtyIn: number,
  unitCostIn: number | null,
): StockPosition {
  if (qtyIn <= 0) {
    throw new Error(`Una entrada exige cantidad positiva; se recibio ${qtyIn}`)
  }

  const newQty = current.qtyOnHand + qtyIn

  if (unitCostIn === null) {
    return { qtyOnHand: newQty, avgCost: current.avgCost }
  }
  if (unitCostIn < 0) {
    throw new Error(`El costo no puede ser negativo; se recibio ${unitCostIn}`)
  }

  // Sin existencia previa (o en negativo) no hay nada que promediar.
  if (current.qtyOnHand <= 0) {
    return { qtyOnHand: newQty, avgCost: roundBankers(unitCostIn, COST_DECIMALS) }
  }

  const valorActual = current.qtyOnHand * current.avgCost
  const valorEntrada = qtyIn * unitCostIn
  const avgCost = roundBankers((valorActual + valorEntrada) / newQty, COST_DECIMALS)

  return { qtyOnHand: newQty, avgCost }
}

/**
 * Aplica una SALIDA (venta, merma, ajuste negativo). El promedio NO cambia:
 * las salidas consumen al costo vigente, que es toda la gracia del metodo.
 */
export function applyOutbound(current: StockPosition, qtyOut: number): StockPosition {
  if (qtyOut <= 0) {
    throw new Error(`Una salida exige cantidad positiva; se recibio ${qtyOut}`)
  }
  return { qtyOnHand: current.qtyOnHand - qtyOut, avgCost: current.avgCost }
}

/** Valor del inventario de una posicion, redondeado a moneda. */
export function positionValue(position: StockPosition): number {
  return roundBankers(position.qtyOnHand * position.avgCost, 2)
}

/** Valor total de varias posiciones. Se suma en crudo y se redondea al final. */
export function totalValue(positions: StockPosition[]): number {
  const bruto = positions.reduce((acc, p) => acc + p.qtyOnHand * p.avgCost, 0)
  return roundBankers(bruto, 2)
}

/** Unidades comprometidas descontadas: lo que de verdad se puede vender. */
export function availableQty(qtyOnHand: number, qtyReserved: number): number {
  return qtyOnHand - qtyReserved
}

/**
 * Bajo minimo. Sin punto de reorden definido no hay alerta: no se inventa un
 * umbral, porque una alerta que nadie configuro es ruido que se ignora.
 */
export function isLowStock(qtyOnHand: number, reorderPoint: number | null): boolean {
  if (reorderPoint === null) return false
  return qtyOnHand <= reorderPoint
}

/** Diferencia de un conteo fisico. Positiva = sobrante, negativa = faltante. */
export function countVariance(countedQty: number, systemQty: number): number {
  return countedQty - systemQty
}

/** Impacto en pesos de una diferencia de conteo, al costo vigente. */
export function varianceValue(variance: number, avgCost: number): number {
  return roundBankers(variance * avgCost, 2)
}
