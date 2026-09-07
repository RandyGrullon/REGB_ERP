import { roundBankers } from '@regb/core'
import { accountBalance, type AccountType } from './accounting.js'

/**
 * Presupuestos — §5, modulo 22 (F6/S35).
 *
 * "Presupuestado" y "real" se comparan en la MISMA direccion normal de la
 * cuenta -reusa accountBalance() de accounting.ts, no reinventa el signo-:
 * para una cuenta de gasto, presupuestar RD$50,000 significa "planeo
 * gastar hasta ahi", y el real se lee igual de deudor. Para una cuenta de
 * ingreso, presupuestar RD$50,000 significa "espero ganar eso", y el real
 * se lee igual de acreedor. La misma formula sirve para las dos sin
 * distinguir casos.
 */

export interface BudgetActualInput {
  accountId: string
  accountType: AccountType
  month: number
  budgeted: number
  totalDebit: number
  totalCredit: number
}

export type BudgetStatus = 'ok' | 'warning' | 'over'

export interface BudgetVsActualRow {
  accountId: string
  month: number
  budgeted: number
  actual: number
  variance: number
  variancePercent: number | null
  status: BudgetStatus
}

/**
 * Que tan cerca esta el real del presupuesto. Sin presupuesto (0) y sin
 * gasto real, no hay nada que avisar; sin presupuesto pero CON gasto real,
 * eso es lo mas grave -se gasto algo que no se planeo en absoluto-.
 */
export function budgetStatus(budgeted: number, actual: number, warningPercent = 90): BudgetStatus {
  if (budgeted <= 0) return actual > 0 ? 'over' : 'ok'
  const porcentaje = (actual / budgeted) * 100
  if (porcentaje > 100) return 'over'
  if (porcentaje >= warningPercent) return 'warning'
  return 'ok'
}

/** Arma el comparativo real contra presupuesto, cuenta por cuenta y mes por mes. */
export function buildBudgetVsActual(
  rows: BudgetActualInput[],
  warningPercent = 90,
): BudgetVsActualRow[] {
  return rows.map((r) => {
    const actual = accountBalance(r.accountType, r.totalDebit, r.totalCredit)
    const variance = roundBankers(r.budgeted - actual, 2)
    const variancePercent = r.budgeted !== 0 ? roundBankers((actual / r.budgeted) * 100, 1) : null
    return {
      accountId: r.accountId,
      month: r.month,
      budgeted: roundBankers(r.budgeted, 2),
      actual,
      variance,
      variancePercent,
      status: budgetStatus(r.budgeted, actual, warningPercent),
    }
  })
}
