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

/** De donde salio un asiento (`journal_entries.source_type`, 0131). */
export const ORIGEN_ASIENTO: Record<string, string> = {
  manual: 'Manual',
  pos_sale: 'Venta de caja',
  pos_sale_void: 'Anulacion de venta',
  ar_invoice: 'Factura a credito',
  ar_invoice_void: 'Anulacion de factura',
  ar_payment: 'Cobro',
  ar_payment_reversal: 'Reverso de cobro',
  ar_credit_note: 'Nota de credito',
  ar_late_fee: 'Cargo por mora',
  ap_invoice: 'Factura de proveedor',
  ap_invoice_void: 'Anulacion de factura de proveedor',
  ap_payment: 'Pago a proveedor',
}

export const TIPO_CUENTA: Record<string, string> = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio',
  revenue: 'Ingreso',
  expense: 'Gasto',
}
