/**
 * Portal del Empleado -Sec5.6, modulo 70 (F7/S40).
 *
 * El portal es sobre todo una VENTANA de autoservicio sobre datos que ya
 * existen y ya se calculan en otros modulos -el saldo de vacaciones sigue
 * siendo `saldoVacaciones()` de `time-off.ts`, el volante sigue siendo la
 * fila de `payroll_lines` que `payroll` ya calculo y dejo inmutable-. La
 * unica logica genuinamente nueva aqui es sobre los anuncios.
 */

/** Si un anuncio todavia cuenta como "reciente" -para resaltarlo en el portal-. */
export function esAnuncioVigente(publishedAt: Date, asOf: Date, diasVigencia = 14): boolean {
  const diasTranscurridos = (asOf.getTime() - publishedAt.getTime()) / 86_400_000
  return diasTranscurridos >= 0 && diasTranscurridos <= diasVigencia
}
