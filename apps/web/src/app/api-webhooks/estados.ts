/** Etiquetas de estado de llaves y endpoints, y el catalogo fijo de permisos. */
export const ESTADO_LLAVE: Record<string, string> = {
  active: 'Activa',
  revoked: 'Revocada',
}

export const ESTADO_ENDPOINT: Record<string, string> = {
  active: 'Activo',
  paused: 'Pausado',
}

export const SCOPES_DISPONIBLES = ['read', 'write', 'webhooks'] as const

export const SCOPE_LABEL: Record<string, string> = {
  read: 'Leer datos',
  write: 'Escribir datos',
  webhooks: 'Gestionar webhooks',
}
