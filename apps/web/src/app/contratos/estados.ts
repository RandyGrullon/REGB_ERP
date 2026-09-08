/** Etiquetas del estado de un contrato. */
export const ESTADO_CONTRATO: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activo',
  renewed: 'Renovado',
  cancelled: 'Cancelado',
  expired: 'Vencido',
}

/** Etiquetas de la frecuencia de facturacion. */
export const FRECUENCIA_FACTURACION: Record<string, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  annual: 'Anual',
}
