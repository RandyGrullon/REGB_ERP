/** Etiquetas del tipo de prestamo. */
export const TIPO_PRESTAMO: Record<string, string> = {
  loan: 'Prestamo',
  advance: 'Adelanto',
}

/** Etiquetas del estado de un prestamo. */
export const ESTADO_PRESTAMO: Record<string, string> = {
  active: 'Activo',
  paid: 'Saldado',
  cancelled: 'Cancelado',
}

/** Etiquetas de la fuente de un pago. */
export const FUENTE_PAGO: Record<string, string> = {
  payroll: 'Nomina',
  cash: 'Efectivo',
  transfer: 'Transferencia',
}

/** Etiquetas del estado de una inscripcion. */
export const ESTADO_INSCRIPCION: Record<string, string> = {
  active: 'Activa',
  cancelled: 'Cancelada',
}
