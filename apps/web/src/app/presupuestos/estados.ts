/** Etiquetas de estado de un presupuesto y de una linea real-vs-presupuesto. */
export type BudgetTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_PRESUPUESTO: Record<string, { label: string; tone: BudgetTone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  active: { label: 'Activo', tone: 'info' },
  closed: { label: 'Cerrado', tone: 'success' },
}

export const ESTADO_LINEA_PRESUPUESTO: Record<string, { label: string; tone: BudgetTone }> = {
  ok: { label: 'Bien', tone: 'success' },
  warning: { label: 'Cerca del limite', tone: 'warning' },
  over: { label: 'Sobrepasado', tone: 'danger' },
}

export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]
