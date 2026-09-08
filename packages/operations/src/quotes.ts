/**
 * Cotizaciones — §5.3, modulo 31.
 *
 * Los totales reutilizan `documentTotals()`/`lineTotals()` de
 * `documents.ts` TAL CUAL -la misma formula que ya usan pedidos,
 * tickets de POS y facturas, documentada alli para que un `grep` de
 * una formula de dinero de una sola ocurrencia (puerta F5)-. La
 * vigencia de una cotizacion reutiliza `certificadoVigente()` de
 * `training.ts` -la quinta vez que se resuelve la misma pregunta
 * ("esto ya vencio?"), despues de fleet, lots-serials, quality y
 * maintenance-.
 */

export { certificadoVigente as cotizacionVigente } from './training.js'

export type EstadoCotizacion = 'draft' | 'sent' | 'approved' | 'rejected' | 'expired' | 'superseded'

const TRANSICIONES_COTIZACION: Record<EstadoCotizacion, EstadoCotizacion[]> = {
  draft: ['sent'],
  sent: ['approved', 'rejected', 'expired'],
  approved: [],
  rejected: [],
  expired: [],
  superseded: [],
}

/**
 * `superseded` no se alcanza por aqui -se pone directo cuando se crea
 * una version nueva de la misma cotizacion, no es un paso que el
 * usuario elija-. Todas las demas son terminales una vez resueltas.
 */
export function transicionValidaCotizacion(actual: EstadoCotizacion, siguiente: EstadoCotizacion): boolean {
  return TRANSICIONES_COTIZACION[actual].includes(siguiente)
}
