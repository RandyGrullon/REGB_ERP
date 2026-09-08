/**
 * Portal de clientes — §5.3, modulo 39.
 *
 * El acceso es por invitacion con token -no un sistema de
 * autenticacion completo, mas parecido a un enlace magico-: quien
 * tenga el enlace entra, por eso una invitacion revocada debe dejar
 * de funcionar de inmediato y el estado se valida en cada visita, no
 * solo al invitar.
 */

export type EstadoInvitacion = 'pending' | 'active' | 'revoked'

const TRANSICIONES_INVITACION: Record<EstadoInvitacion, EstadoInvitacion[]> = {
  pending: ['active', 'revoked'],
  active: ['revoked'],
  revoked: [],
}

/** Una invitacion revocada es terminal -no se reactiva, se invita de nuevo con un token distinto-. */
export function transicionValidaInvitacion(actual: EstadoInvitacion, siguiente: EstadoInvitacion): boolean {
  return TRANSICIONES_INVITACION[actual].includes(siguiente)
}
