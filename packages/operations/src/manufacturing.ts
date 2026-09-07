/**
 * Ordenes de produccion — §5.4, modulo 56.
 *
 * Reutiliza `explotarCantidad()` de `bom.ts` para la explosion de
 * componentes y `progresoResultadoClave()` de `performance.ts` para el
 * porcentaje de avance -misma pregunta ("cuanto se ha completado de
 * la meta?") que ya se resolvio para resultados clave de OKR-. Las
 * unicas funciones nuevas son la maquina de estados de la orden y la
 * tasa de mermas real.
 */

export type EstadoOrdenProduccion = 'draft' | 'released' | 'in_progress' | 'completed' | 'cancelled'

const TRANSICIONES_ORDEN: Record<EstadoOrdenProduccion, EstadoOrdenProduccion[]> = {
  draft: ['released', 'cancelled'],
  released: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
}

/**
 * `draft` libera o cancela; una vez `released` los componentes ya se
 * consumieron -no se cancela una orden que ya consumio inventario,
 * mismo criterio que una transferencia ya despachada-, asi que de ahi
 * solo avanza a `in_progress` con el primer reporte, y de ahi a
 * `completed`.
 */
export function transicionValidaOrdenProduccion(
  actual: EstadoOrdenProduccion,
  siguiente: EstadoOrdenProduccion,
): boolean {
  return TRANSICIONES_ORDEN[actual].includes(siguiente)
}

/** Una orden esta completa cuando lo completado mas lo mermado ya cubre lo planificado. */
export function ordenCompleta(qtyCompletado: number, qtyMermado: number, qtyPlanificado: number): boolean {
  return qtyCompletado + qtyMermado >= qtyPlanificado
}

/** Que fraccion de lo procesado -completado mas mermado- termino en merma. Nunca divide entre cero. */
export function tasaMerma(qtyMermado: number, qtyCompletado: number): number {
  const procesado = qtyMermado + qtyCompletado
  if (procesado === 0) return 0
  return qtyMermado / procesado
}
