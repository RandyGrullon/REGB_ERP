/** Etiquetas del estado de un documento de recepcion. */
export const ESTADO_RECEPCION: Record<string, string> = {
  completed: 'Sin discrepancias',
  with_discrepancies: 'Con discrepancias',
}

/**
 * De donde sale lo devuelto, y por eso si toca el inventario (0131): lo
 * rechazado nunca entro; lo aceptado si.
 */
export const ORIGEN_DEVOLUCION: Record<string, { label: string; efecto: string }> = {
  rejected: { label: 'Rechazado', efecto: 'no mueve inventario: nunca entro' },
  accepted: { label: 'Ya aceptado', efecto: 'sale del almacen al enviarse' },
}

/** Etiquetas del estado de una devolucion al proveedor. */
export const ESTADO_DEVOLUCION: Record<string, string> = {
  pending: 'Pendiente',
  sent: 'Enviada',
  cancelled: 'Cancelada',
}
