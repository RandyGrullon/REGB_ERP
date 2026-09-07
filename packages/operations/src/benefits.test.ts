import { describe, expect, it } from 'vitest'
import { cuotaPrestamo, estaSaldado, saldoPrestamo, totalAportePatronal } from './benefits.js'

describe('cuotaPrestamo', () => {
  it('sin interes, la cuota es una simple division', () => {
    expect(cuotaPrestamo(12000, 12)).toBe(1000)
  })

  it('con interes, aplica el sistema frances de amortizacion', () => {
    // 10000 a 1% mensual en 12 cuotas -verificado a mano con la formula de anualidad-
    expect(cuotaPrestamo(10000, 12, 0.01)).toBeCloseTo(888.49, 1)
  })

  it('un numero de cuotas de cero o negativo no es valido', () => {
    expect(() => cuotaPrestamo(1000, 0)).toThrow()
    expect(() => cuotaPrestamo(1000, -3)).toThrow()
  })
})

describe('saldoPrestamo', () => {
  it('sin pagos, el saldo es todo el principal', () => {
    expect(saldoPrestamo(12000, [])).toBe(12000)
  })

  it('resta lo ya pagado del principal', () => {
    const pagos = [{ amount: 1000 }, { amount: 1000 }]
    expect(saldoPrestamo(12000, pagos)).toBe(10000)
  })

  it('pagar de mas nunca da un saldo negativo', () => {
    const pagos = [{ amount: 20000 }]
    expect(saldoPrestamo(12000, pagos)).toBe(0)
  })
})

describe('estaSaldado', () => {
  it('con saldo pendiente, no esta saldado', () => {
    expect(estaSaldado(12000, [{ amount: 1000 }])).toBe(false)
  })

  it('cuando los pagos igualan el principal, si esta saldado', () => {
    expect(estaSaldado(12000, [{ amount: 6000 }, { amount: 6000 }])).toBe(true)
  })
})

describe('totalAportePatronal', () => {
  it('solo suma las inscripciones activas', () => {
    const inscripciones = [
      { status: 'active', employer_contribution: 1500 },
      { status: 'cancelled', employer_contribution: 900 },
      { status: 'active', employer_contribution: 800 },
    ]
    expect(totalAportePatronal(inscripciones)).toBe(2300)
  })

  it('sin inscripciones activas, el total es cero', () => {
    expect(totalAportePatronal([{ status: 'cancelled', employer_contribution: 500 }])).toBe(0)
  })
})
