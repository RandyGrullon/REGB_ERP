/** Etiquetas del estado de un vehiculo. */
export const ESTADO_VEHICULO: Record<string, string> = {
  active: 'Activo',
  maintenance: 'En mantenimiento',
  retired: 'Retirado',
}

/** Etiquetas del estado de una multa. */
export const ESTADO_MULTA: Record<string, string> = {
  pending: 'Pendiente',
  disputed: 'Disputada',
  paid: 'Pagada',
  dismissed: 'Descartada',
}

/** Etiquetas del tipo de documento del vehiculo. */
export const TIPO_DOCUMENTO: Record<string, string> = {
  license: 'Licencia',
  insurance: 'Seguro',
  inspection: 'Inspeccion',
}
