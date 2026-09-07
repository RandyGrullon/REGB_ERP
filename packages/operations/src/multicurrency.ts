import { roundBankers } from '@regb/core'

/**
 * Multimoneda — §5, modulo 26 (F6/S31).
 *
 * SIN tasas automaticas de una API del BCRD: eso pide una integracion de
 * red real, y este primer corte es honesto en no prometerla -las tasas se
 * capturan a mano, como la retencion de ap o el cargo por mora de ar-.
 * Lo que si resuelve de verdad: convertir con la tasa correcta, encontrar
 * la tasa aplicable a una fecha sin tasa exacta, y calcular la diferencia
 * cambiaria entre dos momentos.
 */

/** A pesos dominicanos, con la tasa (DOP por unidad de moneda extranjera). */
export function convertToBase(amountForeign: number, rate: number): number {
  return roundBankers(amountForeign * rate, 2)
}

/** De pesos dominicanos a moneda extranjera, con la misma tasa. */
export function convertFromBase(amountBase: number, rate: number): number {
  if (rate <= 0) return 0
  return roundBankers(amountBase / rate, 2)
}

/**
 * Diferencia cambiaria: lo que cambio el valor en pesos de un mismo monto
 * en moneda extranjera entre dos tasas -positivo es ganancia, negativo es
 * perdida-. No importa si el monto crecio o bajo en su propia moneda, solo
 * el efecto de la tasa.
 */
export function exchangeDifference(
  amountForeign: number,
  rateOriginal: number,
  rateCurrent: number,
): number {
  return roundBankers(amountForeign * (rateCurrent - rateOriginal), 2)
}

export interface ExchangeRatePoint {
  rateDate: Date
  rate: number
}

/**
 * La tasa aplicable a una fecha: la mas reciente conocida EN o ANTES de
 * `asOf` -sin tasa automatica de API, la captura manual casi nunca tiene
 * el dato exacto del dia, asi que se usa la ultima conocida, nunca una
 * futura-. `null` si no hay ninguna tasa anterior o igual a esa fecha.
 */
export function findApplicableRate(rates: ExchangeRatePoint[], asOf: Date): number | null {
  const limite = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
  let mejor: ExchangeRatePoint | null = null
  for (const r of rates) {
    const dia = Date.UTC(r.rateDate.getFullYear(), r.rateDate.getMonth(), r.rateDate.getDate())
    if (dia > limite) continue
    if (!mejor || dia > Date.UTC(mejor.rateDate.getFullYear(), mejor.rateDate.getMonth(), mejor.rateDate.getDate())) {
      mejor = r
    }
  }
  return mejor?.rate ?? null
}

/** Dias desde la ultima tasa conocida hasta `asOf`. Negativo si la tasa es futura -no deberia pasar-. */
export function daysSinceRate(lastRateDate: Date, asOf: Date): number {
  const MS_DIA = 86_400_000
  const dia = Date.UTC(lastRateDate.getFullYear(), lastRateDate.getMonth(), lastRateDate.getDate())
  const corte = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
  return Math.round((corte - dia) / MS_DIA)
}
