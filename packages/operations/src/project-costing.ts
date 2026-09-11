export { tasaSobre as avanceSobrePresupuesto } from './marketing.js'

/** Desviacion en dinero: positivo = se gasto de mas. */
export function desviacion(presupuesto: number, real: number): number {
  return Math.round((real - presupuesto) * 100) / 100
}

/**
 * Margen como fraccion del presupuesto. `null` cuando no hay
 * presupuesto contra que comparar -no es cero, es "todavia no hay dato",
 * el mismo criterio que `tasaSobre()`-.
 */
export function margen(presupuesto: number, real: number): number | null {
  if (presupuesto <= 0) return null
  return Math.round(((presupuesto - real) / presupuesto) * 10000) / 10000
}

/**
 * Trabajo en curso (WIP): lo gastado que todavia no se ha facturado.
 * Nunca negativo -si se facturo de mas, el WIP es cero, no una deuda-.
 */
export function trabajoEnCurso(costoAcumulado: number, facturado: number): number {
  return Math.max(0, Math.round((costoAcumulado - facturado) * 100) / 100)
}
