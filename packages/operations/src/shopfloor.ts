/**
 * Piso de planta / OEE — §5.5, modulo 60.
 *
 * El tiempo trabajado en el terminal reutiliza `workedHours()` de
 * `attendance.ts` -la misma resta entre entrada y salida, sea un
 * empleado marcando asistencia o un operario marcando una sesion de
 * produccion-. El factor de calidad de OEE reutiliza `tasaMerma()` de
 * `manufacturing.ts`: calidad es simplemente 1 menos la merma, la
 * misma pregunta resuelta dos veces con signo distinto.
 *
 * OEE = disponibilidad x rendimiento x calidad, cada factor
 * recortado a [0,1] -un rendimiento "de mas de 100%" (ciclo ideal mal
 * estimado) no debe inflar el numero final-.
 */

import { workedHours } from './attendance.js'
import { tasaMerma } from './manufacturing.js'

export { workedHours as horasEnTerminal } from './attendance.js'

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** Disponibilidad: tiempo planificado menos tiempo de paro, sobre el planificado. */
export function disponibilidad(horasPlanificadas: number, horasInactivo: number): number {
  if (horasPlanificadas <= 0) return 0
  return clamp01((horasPlanificadas - horasInactivo) / horasPlanificadas)
}

/** Rendimiento: lo que se produjo al ciclo ideal, sobre el tiempo que de verdad se opero. */
export function rendimiento(
  unidadesProducidas: number,
  horasOperando: number,
  cicloIdealHorasPorUnidad: number,
): number {
  if (horasOperando <= 0) return 0
  return clamp01((unidadesProducidas * cicloIdealHorasPorUnidad) / horasOperando)
}

/** Calidad de OEE: 1 menos la tasa de merma -la misma tasaMerma() de manufacturing, con signo invertido-. */
export function calidadOee(qtyMermado: number, qtyCompletado: number): number {
  return 1 - tasaMerma(qtyMermado, qtyCompletado)
}

/** OEE = disponibilidad x rendimiento x calidad, cada factor recortado a [0,1]. */
export function calcularOee(disponibilidadFrac: number, rendimientoFrac: number, calidadFrac: number): number {
  return clamp01(disponibilidadFrac) * clamp01(rendimientoFrac) * clamp01(calidadFrac)
}

/** Horas de paro entre varios eventos de downtime, sumando solo los ya cerrados -uno abierto no se cuenta-. */
export function horasInactivoTotal(eventos: { startedAt: Date; endedAt: Date | null }[]): number {
  return eventos
    .filter((e) => e.endedAt !== null)
    .reduce((total, e) => total + workedHours(e.startedAt, e.endedAt as Date), 0)
}
