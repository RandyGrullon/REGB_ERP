/** Etiquetas del estado de una ruta de entrega. */
export const ESTADO_RUTA: Record<string, string> = {
  planned: 'Planificada',
  in_progress: 'En progreso',
  completed: 'Completada',
  cancelled: 'Cancelada',
}

/** Etiquetas del estado de una parada. */
export const ESTADO_PARADA: Record<string, string> = {
  pending: 'Pendiente',
  delivered: 'Entregada',
  failed: 'Fallida',
}
