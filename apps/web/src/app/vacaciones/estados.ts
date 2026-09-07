/** Etiquetas del tipo de ausencia. */
export const TIPO_AUSENCIA: Record<string, string> = {
  vacation: 'Vacaciones',
  sick: 'Enfermedad',
  personal: 'Personal',
  maternity: 'Maternidad',
  paternity: 'Paternidad',
  bereavement: 'Duelo',
  other: 'Otro',
}

/** Etiquetas del estado de una solicitud. */
export const ESTADO_SOLICITUD: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
}
