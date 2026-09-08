/** Etiquetas del estado de una solicitud de firma. */
export const ESTADO_FIRMA: Record<string, string> = {
  pending: 'Pendiente',
  sent: 'Enviada',
  signed: 'Firmada',
  declined: 'Rechazada',
  expired: 'Vencida',
}

/** Etiquetas del tipo de documento. */
export const TIPO_DOCUMENTO_FIRMA: Record<string, string> = {
  quote: 'Cotizacion',
  contract: 'Contrato',
  other: 'Otro',
}
