import { roundBankers } from '@regb/core'

/**
 * Activos fijos — §5, modulo 21 (F6/S34).
 *
 * Dos metodos de depreciacion: linea recta (monto fijo cada mes) y
 * acelerada -saldos decrecientes al doble de la tasa lineal, la forma
 * mas comun de "acelerada" en la practica contable dominicana-. Ninguno
 * depreciar mas alla del valor de rescate: eso lo impone `Math.max` en
 * cada formula, no una validacion aparte.
 */

export type DepreciationMethod = 'straight_line' | 'declining_balance'

/** Saldo en libros: lo que vale el activo segun la contabilidad hoy. */
export function bookValue(basis: number, accumulatedDepreciation: number): number {
  return roundBankers(basis - accumulatedDepreciation, 2)
}

/**
 * Depreciacion de un periodo (normalmente un mes), nunca mas de lo que
 * falta por depreciar hasta el valor de rescate -un activo no se
 * deprecia por debajo de lo que se espera recuperar al final de su vida-.
 */
export function monthlyDepreciation(
  method: DepreciationMethod,
  basis: number,
  salvageValue: number,
  usefulLifeMonths: number,
  accumulatedDepreciation: number,
): number {
  const valorLibros = bookValue(basis, accumulatedDepreciation)
  const depreciable = Math.max(0, roundBankers(valorLibros - salvageValue, 2))
  if (depreciable <= 0) return 0

  const monto =
    method === 'straight_line'
      ? (basis - salvageValue) / usefulLifeMonths
      : valorLibros * (2 / usefulLifeMonths)

  return roundBankers(Math.min(monto, depreciable), 2)
}

export interface DepreciationScheduleEntry {
  period: number
  depreciation: number
  accumulated: number
  bookValue: number
}

/**
 * Proyecta la depreciacion mes a mes hasta agotar la vida util o hasta
 * llegar al valor de rescate, lo que pase primero -en acelerada, un
 * activo suele llegar al rescate antes del ultimo mes nominal-.
 */
export function buildDepreciationSchedule(
  method: DepreciationMethod,
  basis: number,
  salvageValue: number,
  usefulLifeMonths: number,
): DepreciationScheduleEntry[] {
  const calendario: DepreciationScheduleEntry[] = []
  let acumulado = 0
  for (let periodo = 1; periodo <= usefulLifeMonths; periodo++) {
    const monto = monthlyDepreciation(method, basis, salvageValue, usefulLifeMonths, acumulado)
    if (monto <= 0) break
    acumulado = roundBankers(acumulado + monto, 2)
    calendario.push({
      period: periodo,
      depreciation: monto,
      accumulated: acumulado,
      bookValue: bookValue(basis, acumulado),
    })
  }
  return calendario
}

/** Ganancia (positivo) o perdida (negativo) al dar de baja un activo. */
export function disposalGainLoss(disposedAmount: number, bookValueAtDisposal: number): number {
  return roundBankers(disposedAmount - bookValueAtDisposal, 2)
}
