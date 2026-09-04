/** Etiquetas de estado de una factura de proveedor. */
export type InvoiceStatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_FACTURA: Record<string, { label: string; tone: InvoiceStatusTone }> = {
  open: { label: 'Abierta', tone: 'info' },
  partially_paid: { label: 'Abonada', tone: 'warning' },
  paid: { label: 'Pagada', tone: 'success' },
  overdue: { label: 'Vencida', tone: 'danger' },
  void: { label: 'Anulada', tone: 'neutral' },
}
