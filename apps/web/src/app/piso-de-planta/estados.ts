/** Etiquetas del estado de una orden de produccion, tal como las ve el terminal. */
export const ESTADO_ORDEN_TERMINAL: Record<string, string> = {
  draft: 'Borrador',
  released: 'Liberada',
  in_progress: 'En progreso',
  completed: 'Completada',
  cancelled: 'Cancelada',
}
