export type OperadorCondicion = 'eq' | 'neq' | 'gt' | 'lt'

/**
 * Compara el valor de un campo del payload contra lo esperado. `gt`/`lt`
 * intentan comparar como numero -si no lo son, caen a comparacion de texto,
 * para que una fecha ISO o un texto tambien se puedan ordenar-.
 */
export function condicionCumple(valor: string, operador: OperadorCondicion, esperado: string): boolean {
  if (operador === 'eq') return valor === esperado
  if (operador === 'neq') return valor !== esperado

  const numValor = Number(valor)
  const numEsperado = Number(esperado)
  const ambosNumericos = Number.isFinite(numValor) && Number.isFinite(numEsperado)
  const a = ambosNumericos ? numValor : valor
  const b = ambosNumericos ? numEsperado : esperado

  return operador === 'gt' ? a > b : a < b
}

export const ACCIONES_AUTOMATIZACION = ['create_notification'] as const
export type AccionAutomatizacion = (typeof ACCIONES_AUTOMATIZACION)[number]

export function accionValida(valor: string): valor is AccionAutomatizacion {
  return (ACCIONES_AUTOMATIZACION as readonly string[]).includes(valor)
}

/** Mismo formato que emit_event() exige en la base: <modulo>.<entidad>.<accion>. */
export function tipoEventoValido(valor: string): boolean {
  return /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/.test(valor)
}
