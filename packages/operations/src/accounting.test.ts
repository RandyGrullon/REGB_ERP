import { describe, expect, it } from 'vitest'
import {
  accountBalance,
  buildTrialBalance,
  normalBalance,
  validateEntryLines,
  type TrialBalanceRow,
} from './accounting.js'

describe('normalBalance', () => {
  it('activo y gasto son deudores', () => {
    expect(normalBalance('asset')).toBe('debit')
    expect(normalBalance('expense')).toBe('debit')
  })

  it('pasivo, patrimonio e ingreso son acreedores', () => {
    expect(normalBalance('liability')).toBe('credit')
    expect(normalBalance('equity')).toBe('credit')
    expect(normalBalance('revenue')).toBe('credit')
  })
})

describe('accountBalance', () => {
  it('un activo con mas debito que credito da positivo', () => {
    expect(accountBalance('asset', 1000, 300)).toBe(700)
  })

  it('un pasivo con mas credito que debito da positivo', () => {
    expect(accountBalance('liability', 200, 1000)).toBe(800)
  })

  it('una cuenta al reves de su saldo normal da negativo, no cero', () => {
    // Un activo con mas credito que debito: la cuenta esta "al reves".
    // Esconderlo como si fuera cero seria peor que mostrar el signo.
    expect(accountBalance('asset', 100, 500)).toBe(-400)
  })
})

describe('validateEntryLines', () => {
  it('un asiento cuadrado con dos lineas es valido', () => {
    expect(validateEntryLines([{ debit: 1000, credit: 0 }, { debit: 0, credit: 1000 }])).toEqual({
      ok: true,
    })
  })

  it('un asiento con mas de dos lineas cuadradas tambien es valido', () => {
    const r = validateEntryLines([
      { debit: 600, credit: 0 },
      { debit: 400, credit: 0 },
      { debit: 0, credit: 1000 },
    ])
    expect(r).toEqual({ ok: true })
  })

  it('menos de dos lineas se rechaza', () => {
    const r = validateEntryLines([{ debit: 1000, credit: 0 }])
    expect(r.ok).toBe(false)
  })

  it('una linea con debito y credito a la vez se rechaza', () => {
    const r = validateEntryLines([
      { debit: 100, credit: 50 },
      { debit: 0, credit: 50 },
    ])
    expect(r.ok).toBe(false)
  })

  it('una linea vacia se rechaza', () => {
    const r = validateEntryLines([
      { debit: 0, credit: 0 },
      { debit: 100, credit: 100 },
    ])
    expect(r.ok).toBe(false)
  })

  it('un asiento descuadrado se rechaza con el detalle de la diferencia', () => {
    const r = validateEntryLines([
      { debit: 1000, credit: 0 },
      { debit: 0, credit: 900 },
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/1000\.00.*900\.00/)
  })
})

describe('buildTrialBalance', () => {
  const filas: TrialBalanceRow[] = [
    { accountId: '1', accountCode: '1101', accountName: 'Caja', type: 'asset', totalDebit: 1000, totalCredit: 0 },
    { accountId: '2', accountCode: '4101', accountName: 'Ventas', type: 'revenue', totalDebit: 0, totalCredit: 1000 },
  ]

  it('una balanza cuadrada marca balanced true', () => {
    const b = buildTrialBalance(filas)
    expect(b.balanced).toBe(true)
    expect(b.totalDebit).toBe(1000)
    expect(b.totalCredit).toBe(1000)
  })

  it('cada fila trae su saldo en la direccion de su tipo', () => {
    const b = buildTrialBalance(filas)
    expect(b.rows.find((r) => r.accountId === '1')?.balance).toBe(1000)
    expect(b.rows.find((r) => r.accountId === '2')?.balance).toBe(1000)
  })

  it('una balanza descuadrada lo dice: seria un asiento que se colo mal', () => {
    const b = buildTrialBalance([
      ...filas,
      { accountId: '3', accountCode: '9999', accountName: 'Fuera de linea', type: 'asset', totalDebit: 50, totalCredit: 0 },
    ])
    expect(b.balanced).toBe(false)
  })
})
