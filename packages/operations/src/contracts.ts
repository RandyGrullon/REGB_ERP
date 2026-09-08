/**
 * Contratos & Suscripciones — §5.3, modulo 33.
 *
 * La vigencia de un contrato reutiliza `certificadoVigente()` de
 * `training.ts` -sexta vez que se resuelve la misma pregunta ("esto
 * ya vencio?"), despues de fleet, lots-serials, quality, maintenance
 * y quotes-.
 */

export { certificadoVigente as contratoVigente } from './training.js'

export type EstadoContrato = 'draft' | 'active' | 'renewed' | 'cancelled' | 'expired'

const TRANSICIONES_CONTRATO: Record<EstadoContrato, EstadoContrato[]> = {
  draft: ['active'],
  active: ['renewed', 'cancelled', 'expired'],
  renewed: [],
  cancelled: [],
  expired: [],
}

/** Renovado, cancelado o vencido es terminal -la renovacion crea un contrato NUEVO, no reabre este-. */
export function transicionValidaContrato(actual: EstadoContrato, siguiente: EstadoContrato): boolean {
  return TRANSICIONES_CONTRATO[actual].includes(siguiente)
}

/** El monto renovado, aplicando la clausula de escalamiento -nunca por debajo del monto base-. */
export function calcularEscalamiento(montoBase: number, pctEscalamiento: number): number {
  return montoBase * (1 + pctEscalamiento)
}
