/**
 * Etiquetas de estado de una orden de compra.
 *
 * Vive fuera de `page.tsx` por la misma razon que `pedidos/estados.ts`:
 * Next.js solo admite un juego cerrado de exportaciones en un archivo de
 * pagina, y exportar cualquier otra cosa rompe la compilacion de tipos de
 * rutas.
 *
 * Los valores replican `deriveReceiptStatus` de @regb/operations, que es
 * quien decide el estado de verdad a partir de las lineas.
 */
export type OrderStatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADOS: Record<string, { label: string; tone: OrderStatusTone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  confirmed: { label: 'Confirmada', tone: 'info' },
  partially_received: { label: 'Recepcion parcial', tone: 'warning' },
  received: { label: 'Recibida', tone: 'success' },
  cancelled: { label: 'Cancelada', tone: 'danger' },
}
