/** Etiquetas de canal y estado de una campana. */
export const CANAL_CAMPANA: Record<string, string> = {
  email: 'Correo',
  whatsapp: 'WhatsApp',
}

export const ESTADO_CAMPANA: Record<string, string> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  sent: 'Enviada',
  cancelled: 'Cancelada',
}

export const ESTADO_LEAD_FILTRO: Record<string, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  qualified: 'Calificado',
  disqualified: 'Descalificado',
  converted: 'Convertido',
}

export const FUENTE_LEAD_FILTRO: Record<string, string> = {
  referral: 'Referido',
  event: 'Evento',
  web: 'Web',
  cold: 'Frio',
}
