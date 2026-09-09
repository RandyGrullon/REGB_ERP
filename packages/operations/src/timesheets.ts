export type EstadoRegistroTiempo = 'draft' | 'submitted' | 'approved' | 'rejected'

const TRANSICIONES_REGISTRO: Record<EstadoRegistroTiempo, EstadoRegistroTiempo[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: [],
  rejected: ['draft'],
}

export function transicionValidaRegistroTiempo(actual: EstadoRegistroTiempo, siguiente: EstadoRegistroTiempo): boolean {
  return TRANSICIONES_REGISTRO[actual].includes(siguiente)
}

/** Lo que se factura por un registro: horas x tarifa, cero si no es facturable. */
export function montoFacturable(hours: number, hourlyRate: number, billable: boolean): number {
  if (!billable) return 0
  return Math.round(hours * hourlyRate * 100) / 100
}
