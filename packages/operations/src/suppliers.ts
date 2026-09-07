import { certificadoVigente } from './training.js'

/**
 * Proveedores -Sec5.4, modulo 42 (F8/S43).
 *
 * La vigencia de un documento reutiliza certificadoVigente() de
 * training.ts -misma forma exacta: una fecha de vencimiento nullable
 * contra hoy-, en vez de reimplementar la misma comparacion dos veces.
 */

/** Si algun documento del proveedor ya vencio -para marcarlo como riesgo en la ficha-. */
export function tieneDocumentoVencido(
  documentos: { expiresAt: Date | null }[],
  asOf: Date,
): boolean {
  return documentos.some((d) => d.expiresAt !== null && !certificadoVigente(d.expiresAt, asOf))
}
