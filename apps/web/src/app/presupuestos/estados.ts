/** Etiquetas de estado de un presupuesto y de una línea real contra presupuesto. */
export type BudgetTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_PRESUPUESTO: Record<string, { label: string; tone: BudgetTone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  active: { label: 'Activo', tone: 'info' },
  closed: { label: 'Cerrado', tone: 'success' },
}

export const ESTADO_LINEA_PRESUPUESTO: Record<string, { label: string; tone: BudgetTone }> = {
  ok: { label: 'Bien', tone: 'success' },
  warning: { label: 'Cerca del límite', tone: 'warning' },
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

/**
 * Cómo se lee una fila de ingreso. El semáforo de @regb/operations piensa
 * en gasto -pasarse es malo-, pero en una cuenta de ingreso pasarse de la
 * meta es la buena noticia y quedarse corto es lo que hay que mirar. Un
 * mes que todavía no llega no está "por debajo": está por venir.
 */
export function estadoIngreso(
  presupuestado: number,
  real: number,
  mesPorVenir: boolean,
): { label: string; tone: BudgetTone } {
  if (presupuestado <= 0) return { label: 'Sin meta', tone: 'neutral' }
  if (real >= presupuestado) return { label: 'Meta cumplida', tone: 'success' }
  if (mesPorVenir) return { label: 'Por venir', tone: 'neutral' }
  if (real >= presupuestado * 0.9) return { label: 'Cerca de la meta', tone: 'info' }
  return { label: 'Por debajo de la meta', tone: 'warning' }
}

/** Un gasto que no se planeó se dice así, no "sobrepasado" de un cero. */
export function estadoGasto(
  presupuestado: number,
  real: number,
  status: string,
  mesPorVenir = false,
): { label: string; tone: BudgetTone } {
  if (presupuestado <= 0 && real > 0) return { label: 'Sin presupuesto', tone: 'danger' }
  if (mesPorVenir && status === 'ok') return { label: 'Por venir', tone: 'neutral' }
  return ESTADO_LINEA_PRESUPUESTO[status] ?? { label: status, tone: 'neutral' }
}
