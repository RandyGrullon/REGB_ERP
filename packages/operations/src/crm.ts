/**
 * CRM / Leads — §5.3, modulo 29.
 *
 * El puntaje de un lead es una regla explicita, no un modelo de IA:
 * cada senal suma un peso fijo, para que cualquiera pueda explicar
 * por que un lead saco 70 y no 50. La asignacion round-robin reparte
 * leads nuevos entre vendedores activos, recordando donde se quedo la
 * ultima vuelta -para no favorecer siempre al primero de la lista-.
 */

export type EstadoLead = 'new' | 'contacted' | 'qualified' | 'disqualified' | 'converted'

const TRANSICIONES_LEAD: Record<EstadoLead, EstadoLead[]> = {
  new: ['contacted', 'disqualified'],
  contacted: ['qualified', 'disqualified'],
  qualified: ['converted', 'disqualified'],
  disqualified: [],
  converted: [],
}

/** Un lead descalificado o convertido es terminal -no vuelve atras-. */
export function transicionValidaLead(actual: EstadoLead, siguiente: EstadoLead): boolean {
  return TRANSICIONES_LEAD[actual].includes(siguiente)
}

export type FuenteLead = 'referral' | 'event' | 'web' | 'cold'

const PESO_FUENTE: Record<FuenteLead, number> = {
  referral: 40,
  event: 30,
  web: 20,
  cold: 10,
}

/**
 * Puntaje de 0 a 100: 40 puntos por tener email, 20 por tener
 * telefono, y el resto segun la calidad de la fuente -una referencia
 * vale mas que un frio-.
 */
export function puntuarLead(datos: { tieneEmail: boolean; tieneTelefono: boolean; fuente: FuenteLead }): number {
  let puntos = 0
  if (datos.tieneEmail) puntos += 40
  if (datos.tieneTelefono) puntos += 20
  puntos += PESO_FUENTE[datos.fuente]
  return Math.min(100, puntos)
}

/**
 * Reparte leads pendientes entre vendedores activos en round-robin,
 * continuando desde `ultimoIndice` -el indice del ultimo vendedor que
 * recibio un lead la vez anterior- para no siempre empezar por el
 * primero de la lista.
 */
export function asignarRoundRobin(
  leadIds: string[],
  vendedorIds: string[],
  ultimoIndice: number,
): { leadId: string; vendedorId: string }[] {
  if (vendedorIds.length === 0) return []
  return leadIds.map((leadId, i) => {
    const indice = (ultimoIndice + 1 + i) % vendedorIds.length
    return { leadId, vendedorId: vendedorIds[indice]! }
  })
}
