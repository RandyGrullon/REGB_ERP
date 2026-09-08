/**
 * Firma electronica — §5.9, modulo 91.
 *
 * Deliberadamente NO es una firma criptografica con certificado ni
 * PKI: es un flujo de "clic para firmar" con rastro de auditoria
 * -quien, cuando, desde que IP, sobre que version exacta del
 * documento (su hash)-. Se declara honestamente: esto le da
 * trazabilidad real, no la validez legal de una firma digital
 * certificada.
 */

export type EstadoFirma = 'pending' | 'sent' | 'signed' | 'declined' | 'expired'

const TRANSICIONES_FIRMA: Record<EstadoFirma, EstadoFirma[]> = {
  pending: ['sent'],
  sent: ['signed', 'declined', 'expired'],
  signed: [],
  declined: [],
  expired: [],
}

/** Firmada, rechazada o vencida es terminal -no se reabre-. */
export function transicionValidaFirma(actual: EstadoFirma, siguiente: EstadoFirma): boolean {
  return TRANSICIONES_FIRMA[actual].includes(siguiente)
}
