/** Etiquetas del estado y la prioridad de un ticket. */
export const ESTADO_TICKET: Record<string, string> = {
  open: 'Abierto',
  in_progress: 'En proceso',
  waiting_customer: 'Esperando al cliente',
  resolved: 'Resuelto',
  closed: 'Cerrado',
}

export const PRIORIDAD_TICKET: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

/** Horas de SLA por prioridad -se fija al crear el ticket, no cambia despues-. */
export const SLA_HORAS_POR_PRIORIDAD: Record<string, number> = {
  low: 72,
  normal: 24,
  high: 8,
  urgent: 4,
}
