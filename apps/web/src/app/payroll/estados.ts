/** Etiquetas de estado de un periodo de nomina. */
export type PayrollTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_PERIODO: Record<string, { label: string; tone: PayrollTone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  processed: { label: 'Procesado', tone: 'info' },
  paid: { label: 'Pagado', tone: 'success' },
}
