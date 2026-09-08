/** Etiquetas del estado de un lead. */
export const ESTADO_LEAD: Record<string, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  qualified: 'Calificado',
  disqualified: 'Descalificado',
  converted: 'Convertido',
}

/** Etiquetas de la fuente de un lead. */
export const FUENTE_LEAD: Record<string, string> = {
  referral: 'Referido',
  event: 'Evento',
  web: 'Sitio web',
  cold: 'Frio',
}

/** Etiquetas del tipo de actividad. */
export const TIPO_ACTIVIDAD: Record<string, string> = {
  call: 'Llamada',
  email: 'Correo',
  meeting: 'Reunion',
  note: 'Nota',
}
