/** Etiquetas de categoria del gasto. */
export const CATEGORIA_GASTO: Record<string, string> = {
  travel: 'Viaje',
  meals: 'Comidas',
  transport: 'Transporte',
  supplies: 'Suministros',
  lodging: 'Hospedaje',
  other: 'Otro',
}

/** Etiquetas del estado de un gasto. */
export const ESTADO_GASTO: Record<string, string> = {
  submitted: 'Reportado',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  reimbursed: 'Reembolsado',
}

/** Etiquetas del metodo de reembolso. */
export const METODO_REEMBOLSO: Record<string, string> = {
  payroll: 'Nomina',
  transfer: 'Transferencia',
  cash: 'Efectivo',
}
