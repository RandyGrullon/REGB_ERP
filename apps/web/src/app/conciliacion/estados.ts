/** Etiquetas del estado de conciliacion de una linea del estado de cuenta. */
export type MatchTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_LINEA: Record<string, { label: string; tone: MatchTone }> = {
  pending: { label: 'Pendiente', tone: 'warning' },
  matched: { label: 'Conciliada', tone: 'success' },
  ignored: { label: 'Ignorada', tone: 'neutral' },
}
