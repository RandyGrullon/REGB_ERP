import { describe, expect, it } from 'vitest'
import { reconciliationSummary, suggestMatches } from './bank-rec.js'

const dia = (n: number) => new Date(2026, 8, n) // septiembre de 2026

describe('suggestMatches', () => {
  it('empareja un deposito con su movimiento exacto', () => {
    const s = suggestMatches(
      [{ id: 'L1', amount: 5000, lineDate: dia(3) }],
      [{ id: 'T1', amount: 5000, type: 'deposit', transactionDate: dia(3) }],
    )
    expect(s).toEqual([{ lineId: 'L1', transactionId: 'T1', daysApart: 0 }])
  })

  it('un retiro (linea negativa) solo empareja con withdrawal/transfer_out, nunca con un deposito del mismo monto', () => {
    const s = suggestMatches(
      [{ id: 'L1', amount: -1000, lineDate: dia(3) }],
      [{ id: 'T1', amount: 1000, type: 'deposit', transactionDate: dia(3) }],
    )
    expect(s).toEqual([])
  })

  it('respeta el signo tambien para transferencias: entra solo con transfer_in', () => {
    const s = suggestMatches(
      [{ id: 'L1', amount: 8000, lineDate: dia(3) }],
      [{ id: 'T1', amount: 8000, type: 'transfer_out', transactionDate: dia(3) }],
    )
    expect(s).toEqual([])
  })

  it('un monto distinto no es candidato aunque la fecha coincida', () => {
    const s = suggestMatches(
      [{ id: 'L1', amount: 5000, lineDate: dia(3) }],
      [{ id: 'T1', amount: 5001, type: 'deposit', transactionDate: dia(3) }],
    )
    expect(s).toEqual([])
  })

  it('fuera de la ventana de dias no es candidato', () => {
    const s = suggestMatches(
      [{ id: 'L1', amount: 5000, lineDate: dia(3) }],
      [{ id: 'T1', amount: 5000, type: 'deposit', transactionDate: dia(20) }],
      5,
    )
    expect(s).toEqual([])
  })

  it('dentro de la ventana, elige el candidato con la fecha mas cercana', () => {
    const s = suggestMatches(
      [{ id: 'L1', amount: 5000, lineDate: dia(10) }],
      [
        { id: 'lejos', amount: 5000, type: 'deposit', transactionDate: dia(7) },
        { id: 'cerca', amount: 5000, type: 'deposit', transactionDate: dia(9) },
      ],
      5,
    )
    expect(s).toEqual([{ lineId: 'L1', transactionId: 'cerca', daysApart: 1 }])
  })

  it('resuelve primero la linea con menos candidatos: no le roba al que no tenia otra opcion', () => {
    // L1 (dia 10) tiene DOS candidatos: T1 (dia 5, a 5 dias) y T2 (dia 13,
    // a 3 dias -el mas cercano-). L2 (dia 13) tiene UN SOLO candidato: T2
    // -T1 le queda a 8 dias, fuera de la ventana de 5-.
    //
    // Si el algoritmo procesara en el orden de entrada (L1 primero) y cada
    // linea tomara siempre el candidato mas cercano, L1 se quedaria con T2
    // -por ser el mas cercano- y L2 se quedaria sin nada, aunque T2 era su
    // UNICA opcion. Resolver primero la linea con menos candidatos (L2)
    // evita justo eso.
    const s = suggestMatches(
      [
        { id: 'L1', amount: 2000, lineDate: dia(10) },
        { id: 'L2', amount: 2000, lineDate: dia(13) },
      ],
      [
        { id: 'T1', amount: 2000, type: 'deposit', transactionDate: dia(5) },
        { id: 'T2', amount: 2000, type: 'deposit', transactionDate: dia(13) },
      ],
      5,
    )
    expect(s).toContainEqual({ lineId: 'L2', transactionId: 'T2', daysApart: 0 })
    expect(s).toContainEqual({ lineId: 'L1', transactionId: 'T1', daysApart: 5 })
  })

  it('nunca sugiere el mismo movimiento para dos lineas distintas', () => {
    const s = suggestMatches(
      [
        { id: 'L1', amount: 1000, lineDate: dia(1) },
        { id: 'L2', amount: 1000, lineDate: dia(2) },
      ],
      [{ id: 'T1', amount: 1000, type: 'deposit', transactionDate: dia(1) }],
    )
    expect(s).toHaveLength(1)
    const transaccionesUsadas = new Set(s.map((x) => x.transactionId))
    expect(transaccionesUsadas.size).toBe(s.length)
  })

  it('una linea sin ningun candidato simplemente no aparece en las sugerencias', () => {
    const s = suggestMatches(
      [
        { id: 'L1', amount: 5000, lineDate: dia(3) },
        { id: 'L2', amount: 999999, lineDate: dia(3) },
      ],
      [{ id: 'T1', amount: 5000, type: 'deposit', transactionDate: dia(3) }],
    )
    expect(s.map((x) => x.lineId)).toEqual(['L1'])
  })
})

describe('reconciliationSummary', () => {
  it('cuenta cada estado y suma el monto pendiente en valor absoluto', () => {
    const r = reconciliationSummary([
      { status: 'matched', amount: 5000 },
      { status: 'pending', amount: -1200 },
      { status: 'pending', amount: 300 },
      { status: 'ignored', amount: 50 },
    ])
    expect(r).toEqual({ matched: 1, pending: 2, ignored: 1, pendingAmount: 1500 })
  })

  it('sin lineas, todo en cero', () => {
    expect(reconciliationSummary([])).toEqual({
      matched: 0,
      pending: 0,
      ignored: 0,
      pendingAmount: 0,
    })
  })
})
