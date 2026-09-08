/** Etiquetas de etapa de una oportunidad, en el orden del kanban. */
export const ETAPA_OPORTUNIDAD: Record<string, string> = {
  prospecting: 'Prospeccion',
  qualification: 'Calificacion',
  proposal: 'Propuesta',
  negotiation: 'Negociacion',
  won: 'Ganada',
  lost: 'Perdida',
}

/** Etapas activas, en el orden del kanban -won/lost no son columnas, son destinos-. */
export const ETAPAS_KANBAN = ['prospecting', 'qualification', 'proposal', 'negotiation'] as const
