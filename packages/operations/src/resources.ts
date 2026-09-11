export { tasaSobre as porcentajeUtilizacion } from './marketing.js'

/** Horas que todavia caben en la capacidad de alguien. Nunca negativo. */
export function capacidadDisponible(horasCapacidad: number, horasAsignadas: number): number {
  return Math.max(0, Math.round((horasCapacidad - horasAsignadas) * 100) / 100)
}

/**
 * Sobrecarga: mas horas asignadas que capacidad.
 *
 * Estrictamente mayor a proposito: asignar exactamente la capacidad NO
 * es sobrecarga -es una semana llena, que es distinto de una imposible-.
 */
export function estaSobrecargado(horasCapacidad: number, horasAsignadas: number): boolean {
  return horasAsignadas > horasCapacidad
}
