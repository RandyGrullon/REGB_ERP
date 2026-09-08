/** Etiquetas del estado de una comision. */
export const ESTADO_COMISION: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  paid: 'Pagada',
}

/** Etiquetas del esquema de un plan de comision. */
export const ESQUEMA_COMISION: Record<string, string> = {
  percentage: 'Porcentaje',
  fixed: 'Monto fijo',
}
