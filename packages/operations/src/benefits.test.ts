import { describe, expect, it } from 'vitest'
import {
  cuotaPrestamo,
  estaSaldado,
  saldoPrestamo,
  totalAPagarPrestamo,
  totalAportePatronal,
  validarPagoPrestamo,
} from './benefits.js'

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

describe('totalAPagarPrestamo', () => {
  it('sin interes es el principal, aunque la cuota redondee', () => {
    expect(totalAPagarPrestamo(10000, 3, cuotaPrestamo(10000, 3))).toBe(10000)
  })

  it('con interes son todas las cuotas: el interes pactado tambien se cobra', () => {
    const cuota = cuotaPrestamo(10000, 12, 0.01)
    expect(totalAPagarPrestamo(10000, 12, cuota, 0.01)).toBe(Math.round(cuota * 12 * 100) / 100)
    expect(totalAPagarPrestamo(10000, 12, cuota, 0.01)).toBeGreaterThan(10000)
  })

  it('con interes, pagar solo el principal NO salda el prestamo', () => {
    const cuota = cuotaPrestamo(10000, 12, 0.01)
    const total = totalAPagarPrestamo(10000, 12, cuota, 0.01)
    expect(estaSaldado(total, [{ amount: 10000 }])).toBe(false)
  })
})

describe('validarPagoPrestamo', () => {
  it('un pago dentro del saldo pasa, tambien el que lo deja en cero', () => {
    expect(validarPagoPrestamo(2000, 1000)).toBeNull()
    expect(validarPagoPrestamo(2000, 2000)).toBeNull()
  })

  it('un pago mayor que el saldo se rechaza', () => {
    expect(validarPagoPrestamo(1500, 2000)).toMatch(/mayor que lo que queda/)
  })

  it('un pago de cero o negativo se rechaza', () => {
    expect(validarPagoPrestamo(1500, 0)).toMatch(/mayor que cero/)
  })
})
