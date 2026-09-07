/** Etiquetas del estado de homologacion de un proveedor. */
export const ESTADO_HOMOLOGACION: Record<string, string> = {
  pending: 'Pendiente',
  qualified: 'Homologado',
  disqualified: 'Descalificado',
}

/** Etiquetas del tipo de documento. */
export const TIPO_DOCUMENTO: Record<string, string> = {
  rnc_certificate: 'Certificado RNC',
  insurance: 'Seguro',
  tax_compliance: 'Cumplimiento fiscal',
  contract: 'Contrato',
  other: 'Otro',
}
