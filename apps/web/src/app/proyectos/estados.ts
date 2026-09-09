/** Etiquetas de estado de proyectos y tareas. */
export const ESTADO_PROYECTO: Record<string, string> = {
  planning: 'Planificacion',
  active: 'Activo',
  on_hold: 'Pausado',
  completed: 'Completado',
  cancelled: 'Cancelado',
}

export const ESTADO_TAREA: Record<string, string> = {
  todo: 'Pendiente',
  in_progress: 'En curso',
  done: 'Hecha',
  blocked: 'Bloqueada',
}
