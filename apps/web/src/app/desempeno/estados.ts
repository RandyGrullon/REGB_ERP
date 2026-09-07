/** Etiquetas del estado de un objetivo. */
export const ESTADO_OBJETIVO: Record<string, string> = {
  active: 'Activo',
  completed: 'Completado',
  cancelled: 'Cancelado',
}

/** Etiquetas del tipo de evaluacion 360. */
export const TIPO_EVALUACION: Record<string, string> = {
  self: 'Auto-evaluacion',
  manager: 'Jefe',
  peer: 'Par',
  direct_report: 'Reporte directo',
}

/** Etiquetas del estado de un 1:1. */
export const ESTADO_1ON1: Record<string, string> = {
  scheduled: 'Agendada',
  completed: 'Realizada',
  cancelled: 'Cancelada',
}

/** Etiquetas del estado de un plan de mejora. */
export const ESTADO_PLAN_MEJORA: Record<string, string> = {
  active: 'Activo',
  completed: 'Completado',
  cancelled: 'Cancelado',
}
