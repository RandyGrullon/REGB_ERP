import { describe, expect, it } from 'vitest'
import {
  buildConsolidationWorksheet,
  eliminationImpact,
  validateElimination,
  worksheetTotals,
  type ConsolidationAccount,
  type ConsolidationBalanceInput,
  type ConsolidationCompany,
} from './consolidation.js'

/**
 * El caso de siempre: la matriz le facturo 1,000 a la filial y ademas le
 * quedo debiendo. Sin eliminar, el grupo declara 1,000 de ingreso y 1,000
 * de activo que no existen fuera de la familia.
 */
const E1 = 'matriz'
const E2 = 'filial'

const companies: ConsolidationCompany[] = [
  { id: E1, name: 'Matriz SRL' },
  { id: E2, name: 'Filial SRL' },
]

const accounts: ConsolidationAccount[] = [
  { id: 'caja', code: '1100', name: 'Caja y bancos', type: 'asset' },
  { id: 'cxc', code: '1200', name: 'Cuentas por cobrar', type: 'asset' },
  { id: 'cxp', code: '2100', name: 'Cuentas por pagar', type: 'liability' },
  { id: 'capital', code: '3100', name: 'Capital', type: 'equity' },
  { id: 'ingresos', code: '4100', name: 'Ingresos por ventas', type: 'revenue' },
  { id: 'gastos', code: '5100', name: 'Costo de ventas', type: 'expense' },
  { id: 'dormida', code: '6100', name: 'Cuenta sin movimiento', type: 'expense' },
]

const balances: ConsolidationBalanceInput[] = [
  { companyId: E1, accountId: 'caja', totalDebit: 5000, totalCredit: 0 },
  { companyId: E1, accountId: 'cxc', totalDebit: 1000, totalCredit: 0 },
  { companyId: E1, accountId: 'capital', totalDebit: 0, totalCredit: 4000 },
  { companyId: E1, accountId: 'ingresos', totalDebit: 0, totalCredit: 3000 },
  { companyId: E1, accountId: 'gastos', totalDebit: 1000, totalCredit: 0 },
  { companyId: E2, accountId: 'caja', totalDebit: 2000, totalCredit: 0 },
  { companyId: E2, accountId: 'cxp', totalDebit: 0, totalCredit: 1000 },
  { companyId: E2, accountId: 'capital', totalDebit: 0, totalCredit: 500 },
  { companyId: E2, accountId: 'ingresos', totalDebit: 0, totalCredit: 1500 },
  { companyId: E2, accountId: 'gastos', totalDebit: 1000, totalCredit: 0 },
]

const eliminations = [
  // La venta entre ellas: se quita el ingreso de una y el gasto de la otra.
  { debitAccountId: 'ingresos', creditAccountId: 'gastos', amount: 1000 },
  // Lo que una le debe a la otra: no es un activo del grupo.
  { debitAccountId: 'cxp', creditAccountId: 'cxc', amount: 1000 },
]

const hoja = buildConsolidationWorksheet({ companies, accounts, balances, eliminations })
const fila = (id: string) => hoja.rows.find((r) => r.accountId === id)!

describe('buildConsolidationWorksheet', () => {
  it('suma las empresas cuenta por cuenta antes de eliminar', () => {
    expect(fila('caja').porEmpresa[E1]).toBe(5000)
    expect(fila('caja').porEmpresa[E2]).toBe(2000)
    expect(fila('caja').combined).toBe(7000)
  })

  it('una empresa sin movimiento en esa cuenta aparece en cero, no ausente', () => {
    expect(fila('cxc').porEmpresa[E2]).toBe(0)
    expect(fila('cxp').porEmpresa[E1]).toBe(0)
  })

  it('la venta entre empresas desaparece del ingreso y del gasto del grupo', () => {
    expect(fila('ingresos').combined).toBe(4500)
    expect(fila('ingresos').eliminationDebit).toBe(1000)
    expect(fila('ingresos').consolidated).toBe(3500)
    expect(fila('gastos').combined).toBe(2000)
    expect(fila('gastos').eliminationCredit).toBe(1000)
    expect(fila('gastos').consolidated).toBe(1000)
  })

  it('la deuda entre empresas se va de los dos lados: ni activo ni pasivo del grupo', () => {
    expect(fila('cxc').consolidated).toBe(0)
    expect(fila('cxp').consolidated).toBe(0)
  })

  it('una cuenta sin movimiento ni eliminacion no ensucia la hoja', () => {
    expect(hoja.rows.map((r) => r.accountId)).not.toContain('dormida')
  })

  it('respeta el orden en que llegan las cuentas: dos vistas del grupo tienen que coincidir', () => {
    expect(hoja.rows.map((r) => r.accountCode)).toEqual([
      '1100',
      '1200',
      '2100',
      '3100',
      '4100',
      '5100',
    ])
  })

  it('un activo con mas credito que debito da negativo: la cuenta esta al reves y se ve', () => {
    const h = buildConsolidationWorksheet({
      companies,
      accounts,
      balances: [{ companyId: E1, accountId: 'caja', totalDebit: 100, totalCredit: 400 }],
      eliminations: [],
    })
    expect(h.rows[0]!.porEmpresa[E1]).toBe(-300)
    expect(h.rows[0]!.consolidated).toBe(-300)
  })

  it('una eliminacion mayor que el saldo combinado no se recorta: el numero raro se muestra', () => {
    const h = buildConsolidationWorksheet({
      companies,
      accounts,
      balances: [{ companyId: E1, accountId: 'ingresos', totalDebit: 0, totalCredit: 500 }],
      eliminations: [{ debitAccountId: 'ingresos', creditAccountId: 'gastos', amount: 900 }],
    })
    const ingresos = h.rows.find((r) => r.accountId === 'ingresos')!
    expect(ingresos.combined).toBe(500)
    expect(ingresos.consolidated).toBe(-400)
  })

  it('sin empresas ni saldos no hay hoja que pintar', () => {
    const h = buildConsolidationWorksheet({
      companies: [],
      accounts,
      balances: [],
      eliminations: [],
    })
    expect(h.rows).toEqual([])
    expect(h.totals.balanced).toBe(true)
  })
})

describe('worksheetTotals', () => {
  it('la consolidacion cuadra si cada asiento cuadraba y cada eliminacion es un par', () => {
    expect(hoja.totals.totalDebit).toBe(8000)
    expect(hoja.totals.totalCredit).toBe(8000)
    expect(hoja.totals.balanced).toBe(true)
  })

  it('un saldo que se colo sin su contrapartida se delata en el total', () => {
    const t = worksheetTotals([
      {
        accountId: 'caja',
        accountCode: '1100',
        accountName: 'Caja',
        type: 'asset',
        porEmpresa: { [E1]: 900 },
        combined: 900,
        eliminationDebit: 0,
        eliminationCredit: 0,
        consolidated: 900,
      },
    ])
    expect(t.balanced).toBe(false)
  })
})

describe('eliminationImpact', () => {
  it('dice en numero cuanto se habria inflado el grupo sin eliminar', () => {
    expect(eliminationImpact(hoja)).toEqual({
      revenueRemoved: 1000,
      expenseRemoved: 1000,
      assetRemoved: 1000,
      liabilityRemoved: 1000,
    })
  })

  it('sin eliminaciones el impacto es cero y no una frase', () => {
    const h = buildConsolidationWorksheet({ companies, accounts, balances, eliminations: [] })
    expect(eliminationImpact(h)).toEqual({
      revenueRemoved: 0,
      expenseRemoved: 0,
      assetRemoved: 0,
      liabilityRemoved: 0,
    })
  })
})

describe('validateElimination', () => {
  const base = {
    fromCompanyId: E1,
    toCompanyId: E2,
    debitAccountId: 'ingresos',
    creditAccountId: 'gastos',
    amount: 1000,
    memberIds: [E1, E2],
  }

  it('acepta una eliminacion normal entre dos miembros', () => {
    expect(validateElimination(base)).toEqual({ ok: true })
  })

  it('rechaza eliminarse contra uno mismo', () => {
    const r = validateElimination({ ...base, toCompanyId: E1 })
    expect(r).toMatchObject({ ok: false })
  })

  it('rechaza una empresa que no es miembro del grupo', () => {
    const r = validateElimination({ ...base, toCompanyId: 'ajena' })
    expect(r).toMatchObject({ ok: false })
  })

  it('rechaza la misma cuenta al debito y al credito', () => {
    const r = validateElimination({ ...base, creditAccountId: 'ingresos' })
    expect(r).toMatchObject({ ok: false })
  })

  it('rechaza un monto que no es mayor que cero', () => {
    expect(validateElimination({ ...base, amount: 0 })).toMatchObject({ ok: false })
    expect(validateElimination({ ...base, amount: -5 })).toMatchObject({ ok: false })
  })

  it('rechaza cuando falta elegir una empresa', () => {
    expect(validateElimination({ ...base, fromCompanyId: '' })).toMatchObject({ ok: false })
  })
})
