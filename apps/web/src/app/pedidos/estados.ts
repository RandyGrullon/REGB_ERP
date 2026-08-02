/**
 * Etiquetas de estado de un pedido.
 *
 * Vive fuera de `page.tsx` porque Next.js solo admite un juego cerrado de
 * exportaciones en un archivo de pagina (`default`, `metadata`, `dynamic`…);
 * exportar cualquier otra cosa rompe la compilacion de tipos de rutas.
 *
 * Los valores replican `deriveOrderStatus` de @regb/operations, que es
 * quien decide el estado de verdad a partir de las lineas.
 */
export type OrderStatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADOS: Record<string, { label: string; tone: OrderStatusTone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  confirmed: { label: 'Confirmado', tone: 'info' },
  partially_delivered: { label: 'Entrega parcial', tone: 'warning' },
  delivered: { label: 'Entregado', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
}
