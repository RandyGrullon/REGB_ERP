/** Etiquetas del estado de una orden de produccion. */
export const ESTADO_ORDEN: Record<string, string> = {
  draft: 'Borrador',
  released: 'Liberada',
  in_progress: 'En progreso',
  completed: 'Completada',
  cancelled: 'Cancelada',
}
