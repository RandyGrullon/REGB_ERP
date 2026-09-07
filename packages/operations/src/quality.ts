/**
 * Control de calidad — §5.5, modulo 58.
 *
 * La vigencia de un certificado de calidad reutiliza `certificadoVigente()`
 * de `training.ts` -la misma pregunta ("esto ya vencio?") resuelta una
 * tercera vez, despues de `fleet` y `lots-serials`-.
 */

export { certificadoVigente as certificadoCalidadVigente } from './training.js'

export interface ResultadoCriterio {
  aprobado: boolean
  esCritico: boolean
}

/**
 * El resultado de una inspeccion no es un simple "aprobo o no": un
 * criterio critico reprobado siempre reprueba la inspeccion entera,
 * pero un criterio menor reprobado la deja "condicional" -aprobada
 * con salvedad, no reprobada de plano-.
 */
export function resultadoInspeccion(
  resultados: ResultadoCriterio[],
): 'passed' | 'failed' | 'conditional' {
  if (resultados.length === 0) return 'passed'
  if (resultados.some((r) => r.esCritico && !r.aprobado)) return 'failed'
  if (resultados.some((r) => !r.aprobado)) return 'conditional'
  return 'passed'
}

/** Tasa de aprobacion de los criterios de una inspeccion -no del resultado final-. */
export function tasaAprobacionCriterios(resultados: ResultadoCriterio[]): number {
  if (resultados.length === 0) return 1
  return resultados.filter((r) => r.aprobado).length / resultados.length
}

export type EstadoNoConformidad = 'open' | 'investigating' | 'capa_created' | 'closed' | 'dismissed'

const TRANSICIONES_NO_CONFORMIDAD: Record<EstadoNoConformidad, EstadoNoConformidad[]> = {
  open: ['investigating', 'dismissed'],
  investigating: ['capa_created', 'dismissed'],
  capa_created: ['closed'],
  closed: [],
  dismissed: [],
}

/**
 * Una no conformidad solo se cierra pasando por un CAPA -no hay atajo
 * de "investigating" directo a "closed"-: cerrar sin corregir la
 * causa raiz seria fingir que se resolvio.
 */
export function transicionValidaNoConformidad(
  actual: EstadoNoConformidad,
  siguiente: EstadoNoConformidad,
): boolean {
  return TRANSICIONES_NO_CONFORMIDAD[actual].includes(siguiente)
}

export type EstadoCapa = 'open' | 'in_progress' | 'verified' | 'closed'

const TRANSICIONES_CAPA: Record<EstadoCapa, EstadoCapa[]> = {
  open: ['in_progress'],
  in_progress: ['verified'],
  verified: ['closed'],
  closed: [],
}

/**
 * Un CAPA no se cierra sin verificar primero que la accion correctiva
 * de verdad funciono -saltar directo de "en progreso" a "cerrado"
 * seria declarar exito sin comprobarlo-.
 */
export function transicionValidaCapa(actual: EstadoCapa, siguiente: EstadoCapa): boolean {
  return TRANSICIONES_CAPA[actual].includes(siguiente)
}

/** Dias entre la deteccion y hoy -para alertar CAPA que se estan demorando-. */
export function diasAbierto(detectadoEn: Date, asOf: Date): number {
  const ms = asOf.getTime() - detectadoEn.getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}
