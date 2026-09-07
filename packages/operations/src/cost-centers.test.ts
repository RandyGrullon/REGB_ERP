import { describe, expect, it } from 'vitest'
import { buildCostCenterTotals, splitAmount } from './cost-centers.js'

describe('splitAmount', () => {
  it('reparte 50/50 sin residuo', () => {
    const s = splitAmount(100, [
      { costCenterId: 'a', weight: 1 },
      { costCenterId: 'b', weight: 1 },
    ])
    expect(s).toEqual([
      { costCenterId: 'a', amount: 50 },
      { costCenterId: 'b', amount: 50 },
    ])
  })

  it('un reparto en tercios cuadra exacto contra el total, sin perder el centavo del redondeo', () => {
    const s = splitAmount(100, [
      { costCenterId: 'a', weight: 1 },
      { costCenterId: 'b', weight: 1 },
      { costCenterId: 'c', weight: 1 },
    ])
    const suma = s.reduce((acc, x) => acc + x.amount, 0)
    expect(Math.round(suma * 100) / 100).toBe(100)
    expect(s[0]!.amount).toBe(33.33)
    expect(s[1]!.amount).toBe(33.33)
    // el ULTIMO absorbe el residuo, no un reparto arbitrario del error
    expect(s[2]!.amount).toBe(33.34)
  })

  it('los pesos no necesitan sumar 100: se normalizan solos', () => {
    const s = splitAmount(1000, [
      { costCenterId: 'ventas', weight: 2 },
      { costCenterId: 'almacen', weight: 3 },
      { costCenterId: 'admin', weight: 5 },
    ])
    expect(s).toEqual([
      { costCenterId: 'ventas', amount: 200 },
      { costCenterId: 'almacen', amount: 300 },
      { costCenterId: 'admin', amount: 500 },
    ])
  })

  it('sin centros que repartir, no hay nada que devolver', () => {
    expect(splitAmount(500, [])).toEqual([])
  })

  it('peso total en cero no reparte nada -dividir entre cero no tiene sentido-', () => {
    expect(
      splitAmount(500, [
        { costCenterId: 'a', weight: 0 },
        { costCenterId: 'b', weight: 0 },
      ]),
    ).toEqual([])
  })

  it('un solo centro se lleva el total completo', () => {
    expect(splitAmount(750.5, [{ costCenterId: 'unico', weight: 1 }])).toEqual([
      { costCenterId: 'unico', amount: 750.5 },
    ])
  })
})

describe('buildCostCenterTotals', () => {
  it('suma varias asignaciones del mismo centro', () => {
    const t = buildCostCenterTotals([
      { costCenterId: 'ventas', amount: 100 },
      { costCenterId: 'ventas', amount: 50 },
      { costCenterId: 'almacen', amount: 30 },
    ])
    expect(t).toContainEqual({ costCenterId: 'ventas', total: 150 })
    expect(t).toContainEqual({ costCenterId: 'almacen', total: 30 })
  })

  it('sin asignaciones, no hay totales', () => {
    expect(buildCostCenterTotals([])).toEqual([])
  })
})
