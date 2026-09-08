/**
 * Mesa de ayuda — §5.3, modulo 40.
 *
 * El vencimiento del SLA reutiliza `certificadoVigente()` de
 * `training.ts` -septima vez que se resuelve la misma pregunta ("esto
 * ya vencio?") esta fase-. Los dias que un ticket lleva abierto
 * reutilizan `diasAbierto()` de `quality.ts` tal cual -la misma resta
 * que ya mide cuanto lleva abierta una no conformidad-.
 */

export { certificadoVigente as slaVigente } from './training.js'
export { diasAbierto as diasTicketAbierto } from './quality.js'

export type EstadoTicket = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'

const TRANSICIONES_TICKET: Record<EstadoTicket, EstadoTicket[]> = {
  open: ['in_progress'],
  in_progress: ['waiting_customer', 'resolved'],
  waiting_customer: ['in_progress', 'resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
}

/**
 * Un ticket resuelto SI se puede reabrir -el cliente puede responder
 * que el problema sigue-, pero uno cerrado es terminal de verdad.
 */
export function transicionValidaTicket(actual: EstadoTicket, siguiente: EstadoTicket): boolean {
  return TRANSICIONES_TICKET[actual].includes(siguiente)
}
