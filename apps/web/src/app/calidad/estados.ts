/** Etiquetas del alcance de un plan de inspeccion. */
export const ALCANCE_PLAN: Record<string, string> = {
  receiving: 'Recepcion',
  production: 'En proceso',
  final: 'Final',
  other: 'Otro',
}

/** Etiquetas del resultado de una inspeccion. */
export const RESULTADO_INSPECCION: Record<string, string> = {
  passed: 'Aprobada',
  failed: 'Reprobada',
  conditional: 'Condicional',
}

/** Etiquetas de severidad de una no conformidad. */
export const SEVERIDAD_NC: Record<string, string> = {
  minor: 'Menor',
  major: 'Mayor',
  critical: 'Critica',
}

/** Etiquetas del estado de una no conformidad. */
export const ESTADO_NC: Record<string, string> = {
  open: 'Abierta',
  investigating: 'Investigando',
  capa_created: 'CAPA creado',
  closed: 'Cerrada',
  dismissed: 'Descartada',
}

/** Etiquetas del estado de un CAPA. */
export const ESTADO_CAPA: Record<string, string> = {
  open: 'Abierto',
  in_progress: 'En progreso',
  verified: 'Verificado',
  closed: 'Cerrado',
}
