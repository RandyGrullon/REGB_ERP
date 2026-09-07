import { describe, expect, it } from 'vitest'
import { buildBudgetVsActual, budgetStatus } from './budgets.js'

describe('budgetStatus', () => {
  it('bien por debajo del umbral: ok', () => {
    expect(budgetStatus(10000, 5000)).toBe('ok')
  })

  it('en el umbral exacto: warning', () => {
    expect(budgetStatus(10000, 9000, 90)).toBe('warning')
  })

  it('justo por encima de lo presupuestado: over', () => {
    expect(budgetStatus(10000, 10001)).toBe('over')
  })

  it('exactamente en el 100%: no es over todavia, es warning', () => {
    expect(budgetStatus(10000, 10000)).toBe('warning')
  })

  it('sin presupuesto y sin gasto real: ok -no hay nada que avisar-', () => {
    expect(budgetStatus(0, 0)).toBe('ok')
  })

  it('sin presupuesto pero CON gasto real: over -lo mas grave, nada lo planeo-', () => {
    expect(budgetStatus(0, 500)).toBe('over')
  })

  it('un presupuesto negativo se trata igual que sin presupuesto', () => {
    expect(budgetStatus(-100, 50)).toBe('over')
  })
})

describe('buildBudgetVsActual', () => {
  it('cuenta de gasto: el real se lee deudor, igual que el presupuesto', () => {
    const [r] = buildBudgetVsActual([
      { accountId: 'a1', accountType: 'expense', month: 1, budgeted: 10000, totalDebit: 8000, totalCredit: 0 },
    ])
    expect(r).toMatchObject({ actual: 8000, budgeted: 10000, variance: 2000, status: 'ok' })
  })

  it('cuenta de ingreso: el real se lee acreedor, igual que el presupuesto', () => {
    const [r] = buildBudgetVsActual([
      { accountId: 'a1', accountType: 'revenue', month: 1, budgeted: 50000, totalDebit: 0, totalCredit: 52000 },
    ])
    expect(r).toMatchObject({ actual: 52000, budgeted: 50000, variance: -2000, status: 'over' })
  })

  it('variancePercent es null cuando el presupuesto es cero -dividir entre cero no tiene sentido-', () => {
    const [r] = buildBudgetVsActual([
      { accountId: 'a1', accountType: 'expense', month: 1, budgeted: 0, totalDebit: 500, totalCredit: 0 },
    ])
    expect(r!.variancePercent).toBeNull()
    expect(r!.status).toBe('over')
  })

  it('variancePercent calcula que porcentaje del presupuesto se consumio', () => {
    const [r] = buildBudgetVsActual([
      { accountId: 'a1', accountType: 'expense', month: 1, budgeted: 4000, totalDebit: 3000, totalCredit: 0 },
    ])
    expect(r!.variancePercent).toBe(75)
  })

  it('procesa varias filas independientes sin mezclar cuentas ni meses', () => {
    const filas = buildBudgetVsActual([
      { accountId: 'gastos-luz', accountType: 'expense', month: 1, budgeted: 5000, totalDebit: 4500, totalCredit: 0 },
      { accountId: 'gastos-luz', accountType: 'expense', month: 2, budgeted: 5000, totalDebit: 6000, totalCredit: 0 },
      { accountId: 'ventas', accountType: 'revenue', month: 1, budgeted: 100000, totalDebit: 0, totalCredit: 95000 },
    ])
    expect(filas).toHaveLength(3)
    expect(filas[0]).toMatchObject({ accountId: 'gastos-luz', month: 1, status: 'warning' })
    expect(filas[1]).toMatchObject({ accountId: 'gastos-luz', month: 2, status: 'over' })
    expect(filas[2]).toMatchObject({ accountId: 'ventas', month: 1, status: 'warning' })
  })
})
