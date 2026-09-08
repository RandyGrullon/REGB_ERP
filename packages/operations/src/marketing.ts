export type EstadoCampana = 'draft' | 'scheduled' | 'sent' | 'cancelled'

const TRANSICIONES_CAMPANA: Record<EstadoCampana, EstadoCampana[]> = {
  draft: ['scheduled', 'sent', 'cancelled'],
  scheduled: ['sent', 'cancelled'],
  sent: [],
  cancelled: [],
}

export function transicionValidaCampana(actual: EstadoCampana, siguiente: EstadoCampana): boolean {
  return TRANSICIONES_CAMPANA[actual].includes(siguiente)
}

/** Tasa de apertura o de clics: null si no se ha enviado nada -no es cero, es "todavia no hay dato"-. */
export function tasaSobre(numerador: number, denominador: number): number | null {
  if (denominador <= 0) return null
  return numerador / denominador
}
