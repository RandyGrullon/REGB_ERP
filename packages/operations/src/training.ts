/**
 * Capacitacion (LMS) -Sec5.6, modulo 67 (F7/S42).
 *
 * Si un curso se aprueba y si un certificado sigue vigente se derivan
 * siempre de los datos reales -la nota contra el minimo, la fecha de
 * vencimiento contra hoy-, nunca se guardan como una bandera aparte.
 */

/** Si una nota aprueba un curso -contra su propio minimo, no un 70% fijo para todos-. */
export function aproboEvaluacion(score: number, passingScore: number): boolean {
  return score >= passingScore
}

/** Si un certificado sigue vigente -sin fecha de vencimiento, nunca vence-. */
export function certificadoVigente(expiresAt: Date | null, asOf: Date): boolean {
  if (expiresAt === null) return true
  return asOf <= expiresAt
}

/** Nivel promedio de una competencia entre todos los empleados evaluados -para la matriz-. */
export function nivelPromedioCompetencia(niveles: number[]): number | null {
  if (niveles.length === 0) return null
  return Math.round((niveles.reduce((acc, n) => acc + n, 0) / niveles.length) * 10) / 10
}
