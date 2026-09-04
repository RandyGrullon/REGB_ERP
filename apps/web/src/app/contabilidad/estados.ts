/**
 * Etiquetas de estado de un asiento contable.
 *
 * Vive fuera de `page.tsx` por la misma razon que en compras/pedidos:
 * Next.js solo admite un juego cerrado de exportaciones en un archivo de
 * pagina.
 */
export type EntryStatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const ESTADOS: Record<string, { label: string; tone: EntryStatusTone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  posted: { label: 'Contabilizado', tone: 'success' },
}

export const TIPO_CUENTA: Record<string, string> = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio',
  revenue: 'Ingreso',
  expense: 'Gasto',
}
