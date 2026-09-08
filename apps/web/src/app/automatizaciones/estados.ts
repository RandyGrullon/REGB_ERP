/** Etiquetas de estado, operador y accion de una regla de automatizacion. */
export const ESTADO_REGLA: Record<string, string> = {
  active: 'Activa',
  paused: 'Pausada',
}

export const OPERADOR_CONDICION: Record<string, string> = {
  eq: 'es igual a',
  neq: 'es distinto de',
  gt: 'es mayor que',
  lt: 'es menor que',
}

export const ACCION_LABEL: Record<string, string> = {
  create_notification: 'Crear una notificacion',
}
