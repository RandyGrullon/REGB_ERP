/** Etiquetas de estado de una orden de servicio. */
export const ESTADO_ORDEN: Record<string, string> = {
  draft: 'Borrador',
  scheduled: 'Agendada',
  in_progress: 'En sitio',
  done: 'Terminada',
  cancelled: 'Cancelada',
}

export const PRIORIDAD_ORDEN: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}
