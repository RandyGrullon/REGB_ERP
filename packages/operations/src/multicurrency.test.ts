import { describe, expect, it } from 'vitest'
import {
  convertFromBase,
  convertToBase,
  daysSinceRate,
  exchangeDifference,
  findApplicableRate,
} from './multicurrency.js'

const dia = (n: number) => new Date(2026, 8, n)

describe('convertToBase / convertFromBase', () => {
  it('convierte a pesos multiplicando por la tasa', () => {
    expect(convertToBase(100, 58.5)).toBe(5850)
  })

  it('convierte de pesos dividiendo por la tasa', () => {
    expect(convertFromBase(5850, 58.5)).toBe(100)
  })

  it('con tasa cero, convertir de pesos da cero -dividir entre cero no tiene sentido-', () => {
    expect(convertFromBase(1000, 0)).toBe(0)
  })
})

describe('exchangeDifference', () => {
  it('la tasa subio: ganancia', () => {
    expect(exchangeDifference(100, 58, 60)).toBe(200)
  })

  it('la tasa bajo: perdida', () => {
    expect(exchangeDifference(100, 60, 58)).toBe(-200)
  })

  it('la tasa no cambio: sin diferencia', () => {
    expect(exchangeDifference(100, 58.5, 58.5)).toBe(0)
  })
})

describe('findApplicableRate', () => {
  it('usa la tasa exacta del dia si existe', () => {
    const r = findApplicableRate(
      [
        { rateDate: dia(1), rate: 58.0 },
        { rateDate: dia(5), rate: 58.5 },
      ],
      dia(5),
    )
    expect(r).toBe(58.5)
  })

  it('sin tasa exacta, usa la mas reciente ANTERIOR a la fecha', () => {
    const r = findApplicableRate(
      [
        { rateDate: dia(1), rate: 58.0 },
        { rateDate: dia(5), rate: 58.5 },
      ],
      dia(8),
    )
    expect(r).toBe(58.5)
  })

  it('nunca usa una tasa futura', () => {
    const r = findApplicableRate(
      [
        { rateDate: dia(1), rate: 58.0 },
        { rateDate: dia(20), rate: 59.0 },
      ],
      dia(5),
    )
    expect(r).toBe(58.0)
  })

  it('sin ninguna tasa anterior o igual, no hay nada aplicable', () => {
    const r = findApplicableRate([{ rateDate: dia(20), rate: 59.0 }], dia(5))
    expect(r).toBeNull()
  })

  it('sin tasas registradas, no hay nada aplicable', () => {
    expect(findApplicableRate([], dia(5))).toBeNull()
  })

  it('el orden de entrada no importa: siempre elige la mas reciente valida', () => {
    const r = findApplicableRate(
      [
        { rateDate: dia(5), rate: 58.5 },
        { rateDate: dia(1), rate: 58.0 },
        { rateDate: dia(3), rate: 58.2 },
      ],
      dia(4),
    )
    expect(r).toBe(58.2)
  })
})

describe('daysSinceRate', () => {
  it('cuenta los dias desde la ultima tasa conocida', () => {
    expect(daysSinceRate(dia(1), dia(10))).toBe(9)
  })

  it('el mismo dia da cero', () => {
    expect(daysSinceRate(dia(5), dia(5))).toBe(0)
  })
})
