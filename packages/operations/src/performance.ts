import { roundBankers } from '@regb/core'

/**
 * Desempeno -Sec5.6, modulo 66 (F7/S42).
 *
 * El progreso de un resultado clave y de un objetivo NUNCA se guarda:
 * se deriva siempre del valor actual contra la meta -mismo principio
 * que el saldo de vacaciones o el saldo de un prestamo-.
 */

/** Progreso de un resultado clave, en porcentaje -0 a 100, nunca fuera de rango-. */
export function progresoResultadoClave(current: number, target: number): number {
  if (target === 0) return current === 0 ? 100 : 0
  const pct = (current / target) * 100
  return roundBankers(Math.min(100, Math.max(0, pct)), 1)
}

/** Progreso de un objetivo: el promedio del progreso de sus resultados clave. */
export function progresoObjetivo(resultadosClave: { current: number; target: number }[]): number {
  if (resultadosClave.length === 0) return 0
  const total = resultadosClave.reduce(
    (acc, kr) => acc + progresoResultadoClave(kr.current, kr.target),
    0,
  )
  return roundBankers(total / resultadosClave.length, 1)
}

/** Promedio de una evaluacion 360 -de todos los calificadores del ciclo-. */
export function promedioEvaluacion360(calificaciones: number[]): number | null {
  if (calificaciones.length === 0) return null
  return roundBankers(calificaciones.reduce((acc, c) => acc + c, 0) / calificaciones.length, 2)
}
