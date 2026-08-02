/**
 * Etiquetas de estado de una factura de cliente.
 *
 * Fuera de `page.tsx` porque Next.js solo admite un juego cerrado de
 * exportaciones en un archivo de pagina. Replica `deriveInvoiceStatus` de
 * @regb/operations, que es quien lo decide de verdad a partir de los cobros.
 */
export type InvoiceTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADO_FACTURA: Record<string, { label: string; tone: InvoiceTone }> = {
  open: { label: 'Abierta', tone: 'info' },
  partially_paid: { label: 'Abonada', tone: 'warning' },
  paid: { label: 'Pagada', tone: 'success' },
  overdue: { label: 'Vencida', tone: 'danger' },
  void: { label: 'Anulada', tone: 'neutral' },
}
