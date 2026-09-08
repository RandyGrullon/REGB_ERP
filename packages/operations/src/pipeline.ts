/**
 * Oportunidades / Pipeline de ventas — §5.3, modulo 30.
 *
 * `diasEnEtapa()` reutiliza `diasEnPipeline()` de `recruiting.ts` tal
 * cual -la misma resta de dias entre una fecha y hoy, sea un
 * candidato en un pipeline de contratacion o una oportunidad en un
 * pipeline de ventas-. La maquina de estados sigue el mismo patron
 * (secuencial hacia adelante, con una salida terminal alcanzable
 * desde cualquier etapa no terminal) que ya uso `recruiting.ts`, mismo
 * criterio, distinto tipo -no se puede reutilizar la funcion en si
 * porque los estados son otros-.
 */

export { diasEnPipeline as diasEnEtapa } from './recruiting.js'

export type EstadoOportunidad =
  | 'prospecting'
  | 'qualification'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost'

const ORDEN_ETAPA: EstadoOportunidad[] = ['prospecting', 'qualification', 'proposal', 'negotiation', 'won']

/**
 * Avanzar es un paso a la vez -no saltar de "prospecting" directo a
 * "negotiation"-. "lost" se puede marcar desde cualquier etapa no
 * terminal; "won" y "lost" son terminales.
 */
export function transicionValidaEtapa(actual: EstadoOportunidad, siguiente: EstadoOportunidad): boolean {
  if (actual === 'won' || actual === 'lost') return false
  if (siguiente === 'lost') return true

  const iActual = ORDEN_ETAPA.indexOf(actual)
  const iSiguiente = ORDEN_ETAPA.indexOf(siguiente)
  if (iActual === -1 || iSiguiente === -1) return false
  return iSiguiente === iActual + 1
}

export interface OportunidadPonderable {
  amount: number
  probability: number
}

/** Pronostico ponderado: suma de cada monto por su probabilidad -no el monto crudo-. */
export function forecastPonderado(oportunidades: OportunidadPonderable[]): number {
  return oportunidades.reduce((total, o) => total + o.amount * o.probability, 0)
}

/** Probabilidad por defecto de cada etapa -ajustable por oportunidad, esto es solo el punto de partida-. */
export const PROBABILIDAD_POR_ETAPA: Record<EstadoOportunidad, number> = {
  prospecting: 0.1,
  qualification: 0.25,
  proposal: 0.5,
  negotiation: 0.75,
  won: 1,
  lost: 0,
}
