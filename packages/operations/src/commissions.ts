/**
 * Comisiones — §5.3, modulo 34.
 *
 * `calcularComision()` es la unica formula: porcentaje sobre una
 * base, o un monto fijo -nunca una mezcla ambigua-. La maquina de
 * estados de liquidacion sigue el mismo patron que ya uso `quality`
 * para un CAPA: no se puede pagar sin aprobar primero.
 */

export type EsquemaComision = 'percentage' | 'fixed'

/** Comision sobre una base (porcentaje 0-1) o un monto fijo -segun el esquema del plan-. */
export function calcularComision(baseAmount: number, rate: number, esquema: EsquemaComision): number {
  if (esquema === 'fixed') return rate
  return baseAmount * rate
}

export type EstadoComision = 'pending' | 'approved' | 'rejected' | 'paid'

const TRANSICIONES_COMISION: Record<EstadoComision, EstadoComision[]> = {
  pending: ['approved', 'rejected'],
  approved: ['paid'],
  rejected: [],
  paid: [],
}

/** No se puede pagar una comision sin aprobarla primero -mismo criterio que un CAPA de quality-. */
export function transicionValidaComision(actual: EstadoComision, siguiente: EstadoComision): boolean {
  return TRANSICIONES_COMISION[actual].includes(siguiente)
}
