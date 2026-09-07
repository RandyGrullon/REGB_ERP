/** Etiquetas del estado de una vacante. */
export const ESTADO_VACANTE: Record<string, string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  on_hold: 'En pausa',
}

/** Etiquetas de la etapa del pipeline. */
export const ETAPA_APLICACION: Record<string, string> = {
  applied: 'Aplico',
  screening: 'En filtro',
  interview: 'Entrevista',
  offer: 'Oferta',
  hired: 'Contratado',
  rejected: 'Rechazado',
}

/** Etiquetas de la fuente del candidato. */
export const FUENTE_CANDIDATO: Record<string, string> = {
  referral: 'Referido',
  website: 'Sitio web',
  other: 'Otro',
}

/** Etiquetas del resultado de una entrevista. */
export const RESULTADO_ENTREVISTA: Record<string, string> = {
  pending: 'Pendiente',
  passed: 'Aprobada',
  failed: 'No aprobada',
}
