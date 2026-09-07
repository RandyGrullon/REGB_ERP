import { describe, expect, it } from 'vitest'
import {
  bookValue,
  buildDepreciationSchedule,
  disposalGainLoss,
  monthlyDepreciation,
} from './fixed-assets.js'

describe('bookValue', () => {
  it('costo menos depreciacion acumulada', () => {
    expect(bookValue(12000, 4000)).toBe(8000)
  })
})

describe('monthlyDepreciation — linea recta', () => {
  it('monto fijo: (base - rescate) / vida util', () => {
    expect(monthlyDepreciation('straight_line', 12000, 0, 12, 0)).toBe(1000)
  })

  it('nunca deprecia mas alla del valor de rescate', () => {
    // Ya acumulo 11500 de 12000 (rescate 0): solo quedan 500 por depreciar,
    // aunque la formula lineal diria 1000.
    expect(monthlyDepreciation('straight_line', 12000, 0, 12, 11500)).toBe(500)
  })

  it('completamente depreciado, el siguiente periodo da cero', () => {
    expect(monthlyDepreciation('straight_line', 12000, 0, 12, 12000)).toBe(0)
  })
})

describe('monthlyDepreciation — acelerada (saldos decrecientes al doble)', () => {
  it('primer periodo: el doble de la tasa lineal sobre el saldo en libros completo', () => {
    // Tasa = 2/10 = 20%. Primer mes, saldo en libros = base completa.
    expect(monthlyDepreciation('declining_balance', 10000, 1000, 10, 0)).toBe(2000)
  })

  it('el monto baja mes a mes porque se aplica sobre un saldo cada vez menor', () => {
    const p1 = monthlyDepreciation('declining_balance', 10000, 1000, 10, 0)
    const p2 = monthlyDepreciation('declining_balance', 10000, 1000, 10, p1)
    expect(p2).toBeLessThan(p1)
    expect(p2).toBe(1600) // 20% de (10000 - 2000)
  })

  it('nunca deprecia por debajo del valor de rescate, aunque la formula de mas', () => {
    // Saldo en libros = 1100, pero solo faltan 100 para llegar al rescate de 1000.
    expect(monthlyDepreciation('declining_balance', 10000, 1000, 10, 8900)).toBe(100)
  })
})

describe('buildDepreciationSchedule', () => {
  it('linea recta con vida que divide exacto: llega al rescate justo en el ultimo mes', () => {
    const cal = buildDepreciationSchedule('straight_line', 12000, 0, 12)
    expect(cal).toHaveLength(12)
    expect(cal.every((p) => p.depreciation === 1000)).toBe(true)
    expect(cal[11]).toMatchObject({ period: 12, accumulated: 12000, bookValue: 0 })
  })

  it('linea recta con vida que NO divide exacto puede dejar un centavo sin depreciar al final del horizonte nominal', () => {
    // 10000/3 = 3333.333...: el redondeo deja un residuo de un centavo que
    // esta funcion no persigue mas alla de los meses nominales de vida util
    // -es una limitacion conocida, no un bug escondido-.
    const cal = buildDepreciationSchedule('straight_line', 10000, 0, 3)
    expect(cal).toHaveLength(3)
    expect(cal[2]!.bookValue).toBeCloseTo(0, 1)
    expect(cal[2]!.bookValue).toBeGreaterThanOrEqual(0)
  })

  it('acelerada normalmente NO llega exacto al rescate dentro de la vida util nominal', () => {
    // Asintotico por diseno: cada mes deprecia un porcentaje de lo que
    // queda, asi que en la practica contable real esto se combina con un
    // cambio a linea recta en los ultimos anos -no implementado aqui, y
    // documentado como tal en la ficha del modulo-.
    const cal = buildDepreciationSchedule('declining_balance', 10000, 1000, 10)
    expect(cal).toHaveLength(10)
    expect(cal[cal.length - 1]!.bookValue).toBeGreaterThan(1000)
  })

  it('se detiene en cuanto no queda nada por depreciar, sin generar periodos vacios', () => {
    const cal = buildDepreciationSchedule('straight_line', 500, 500, 24)
    expect(cal).toHaveLength(0)
  })
})

describe('disposalGainLoss', () => {
  it('vender por mas del valor en libros es ganancia', () => {
    expect(disposalGainLoss(5000, 3000)).toBe(2000)
  })

  it('vender por menos del valor en libros es perdida', () => {
    expect(disposalGainLoss(1000, 3000)).toBe(-2000)
  })

  it('vender exactamente al valor en libros no da ni ganancia ni perdida', () => {
    expect(disposalGainLoss(3000, 3000)).toBe(0)
  })
})
