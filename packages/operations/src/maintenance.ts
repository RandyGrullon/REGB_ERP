/**
 * Mantenimiento / CMMS — §5.5, modulo 59.
 *
 * El vencimiento de mantenimiento preventivo reutiliza las MISMAS dos
 * funciones de `fleet.ts` -por fecha limite y por uso acumulado-: la
 * pregunta es identica ("ya toca?"), sea un vehiculo con kilometraje o
 * una maquina con horas de uso.
 */

import { mantenimientoVencidoPorFecha, mantenimientoVencidoPorKm } from './fleet.js'

export { mantenimientoVencidoPorFecha as mantenimientoEquipoVencidoPorFecha } from './fleet.js'
export { mantenimientoVencidoPorKm as mantenimientoEquipoVencidoPorUso } from './fleet.js'

export type EstadoOrdenTrabajo = 'open' | 'in_progress' | 'completed' | 'cancelled'

const TRANSICIONES_ORDEN_TRABAJO: Record<EstadoOrdenTrabajo, EstadoOrdenTrabajo[]> = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

/** Una orden completada o cancelada es terminal -no se reabre-. */
export function transicionValidaOrdenTrabajo(
  actual: EstadoOrdenTrabajo,
  siguiente: EstadoOrdenTrabajo,
): boolean {
  return TRANSICIONES_ORDEN_TRABAJO[actual].includes(siguiente)
}

/**
 * MTBF (tiempo medio entre fallas) en dias: el promedio de dias
 * transcurridos entre fallas consecutivas -no desde la primera falla
 * hasta hoy, que mediria otra cosa-. Con menos de dos fallas no hay
 * intervalo que promediar.
 */
export function calcularMtbfDias(fechasFallas: Date[]): number | null {
  if (fechasFallas.length < 2) return null
  const ordenadas = [...fechasFallas].sort((a, b) => a.getTime() - b.getTime())
  let sumaDias = 0
  for (let i = 1; i < ordenadas.length; i++) {
    sumaDias += (ordenadas[i]!.getTime() - ordenadas[i - 1]!.getTime()) / 86_400_000
  }
  return sumaDias / (ordenadas.length - 1)
}

/** Reutiliza la vigencia generica que ya usan fleet/lots-serials/quality -aqui para repuestos con vida util-. */
export function equipoRequiereMantenimiento(
  usoActual: number,
  usoUltimoServicio: number,
  intervaloUso: number,
  fechaLimite: Date | null,
  asOf: Date,
): boolean {
  if (mantenimientoVencidoPorKm(usoActual, usoUltimoServicio, intervaloUso)) return true
  if (fechaLimite !== null && mantenimientoVencidoPorFecha(fechaLimite, asOf)) return true
  return false
}
