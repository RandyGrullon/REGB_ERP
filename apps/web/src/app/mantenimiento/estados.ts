/** Etiquetas del estado de un equipo. */
export const ESTADO_EQUIPO: Record<string, string> = {
  active: 'Activo',
  retired: 'Retirado',
}

/** Etiquetas del tipo de orden de trabajo. */
export const TIPO_ORDEN: Record<string, string> = {
  preventive: 'Preventivo',
  corrective: 'Correctivo',
}

/** Etiquetas del estado de una orden de trabajo. */
export const ESTADO_ORDEN: Record<string, string> = {
  open: 'Abierta',
  in_progress: 'En progreso',
  completed: 'Completada',
  cancelled: 'Cancelada',
}

/** Etiquetas de prioridad de una orden de trabajo. */
export const PRIORIDAD_ORDEN: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}
