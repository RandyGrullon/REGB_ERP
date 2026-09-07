/** Etiquetas del estado de un documento de recepcion. */
export const ESTADO_RECEPCION: Record<string, string> = {
  completed: 'Sin discrepancias',
  with_discrepancies: 'Con discrepancias',
}

/** Etiquetas del estado de una devolucion al proveedor. */
export const ESTADO_DEVOLUCION: Record<string, string> = {
  pending: 'Pendiente',
  sent: 'Enviada',
  cancelled: 'Cancelada',
}
