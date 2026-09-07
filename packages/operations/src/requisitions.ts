/**
 * Requisiciones -Sec5.4, modulo 43 (F8/S44).
 *
 * El flujo de aprobacion por MONTO reutiliza el mecanismo `max_amount`
 * que ya existe en @regb/permissions -`can()`/`exigir()` aceptan un
 * `amount` y lo comparan contra el limite del rol de quien aprueba-,
 * en vez de inventar un motor de aprobacion aparte. La "jerarquia" es
 * el propio sistema de roles: un rol con `max_amount` bajo no puede
 * aprobar un monto alto, y el error ya explica por que -alguien con un
 * rol sin ese limite (Gerente General, Owner) lo aprueba en su lugar-.
 *
 * Lo unico genuinamente nuevo aqui es la maquina de estados.
 */

export type EstadoRequisicion = 'draft' | 'pending' | 'approved' | 'rejected' | 'converted'

/**
 * Si avanzar de un estado a otro es un movimiento valido:
 * draft -> pending -> approved/rejected, y solo approved -> converted.
 * rejected y converted son terminales.
 */
export function transicionValidaRequisicion(
  actual: EstadoRequisicion,
  siguiente: EstadoRequisicion,
): boolean {
  const transiciones: Record<EstadoRequisicion, EstadoRequisicion[]> = {
    draft: ['pending'],
    pending: ['approved', 'rejected'],
    approved: ['converted'],
    rejected: [],
    converted: [],
  }
  return transiciones[actual].includes(siguiente)
}
