/**
 * Cotizacion a proveedores (RFQ) -Sec5.4, modulo 44 (F8/S44).
 *
 * SIN portal de proveedores -cada cotizacion se registra a mano por
 * quien compra, mismo criterio que "sin portal de empleo" en
 * recruiting-. El comparativo automatico que promete el catalogo SI se
 * resuelve de verdad: mejorCotizacion() elige siempre por el monto mas
 * bajo, y desempata por el plazo de entrega mas corto.
 */

export interface Cotizacion {
  supplierId: string
  totalAmount: number
  leadTimeDays: number
}

/** Cual proveedor tiene la mejor cotizacion -menor monto, desempate por menor plazo de entrega-. */
export function mejorCotizacion(cotizaciones: Cotizacion[]): string | null {
  if (cotizaciones.length === 0) return null
  return cotizaciones.reduce((mejor, actual) => {
    if (actual.totalAmount < mejor.totalAmount) return actual
    if (actual.totalAmount === mejor.totalAmount && actual.leadTimeDays < mejor.leadTimeDays) return actual
    return mejor
  }).supplierId
}
