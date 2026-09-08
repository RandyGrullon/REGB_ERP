import { describe, expect, it } from 'vitest'
import {
  descuentoCupon,
  nivelPorPuntosDeVida,
  puntosGanados,
  transicionValidaCupon,
  transicionValidaReferido,
} from './loyalty.js'

describe('puntosGanados', () => {
  it('un punto por cada RD$100, redondeado hacia abajo', () => {
    expect(puntosGanados(999)).toBe(9)
    expect(puntosGanados(1000)).toBe(10)
  })

  it('un total de cero o negativo no gana puntos', () => {
    expect(puntosGanados(0)).toBe(0)
    expect(puntosGanados(-50)).toBe(0)
  })

  it('respeta un monto por punto distinto', () => {
    expect(puntosGanados(250, 50)).toBe(5)
  })
})

describe('nivelPorPuntosDeVida', () => {
  it('bronce por defecto', () => {
    expect(nivelPorPuntosDeVida(0)).toBe('bronce')
    expect(nivelPorPuntosDeVida(499)).toBe('bronce')
  })

  it('plata a partir de 500', () => {
    expect(nivelPorPuntosDeVida(500)).toBe('plata')
    expect(nivelPorPuntosDeVida(1499)).toBe('plata')
  })

  it('oro a partir de 1500', () => {
    expect(nivelPorPuntosDeVida(1500)).toBe('oro')
    expect(nivelPorPuntosDeVida(50_000)).toBe('oro')
  })
})

describe('transicionValidaReferido', () => {
  it('pendiente avanza a completado o expirado', () => {
    expect(transicionValidaReferido('pending', 'completed')).toBe(true)
    expect(transicionValidaReferido('pending', 'expired')).toBe(true)
  })

  it('completado y expirado son terminales', () => {
    expect(transicionValidaReferido('completed', 'pending')).toBe(false)
    expect(transicionValidaReferido('expired', 'completed')).toBe(false)
  })
})

describe('transicionValidaCupon', () => {
  it('activo avanza a redimido o expirado', () => {
    expect(transicionValidaCupon('active', 'redeemed')).toBe(true)
    expect(transicionValidaCupon('active', 'expired')).toBe(true)
  })

  it('redimido y expirado son terminales', () => {
    expect(transicionValidaCupon('redeemed', 'active')).toBe(false)
    expect(transicionValidaCupon('expired', 'redeemed')).toBe(false)
  })
})

describe('descuentoCupon', () => {
  it('porcentaje se aplica sobre el subtotal', () => {
    expect(descuentoCupon(1000, 'percentage', 0.1)).toBe(100)
  })

  it('fijo nunca excede el subtotal', () => {
    expect(descuentoCupon(50, 'fixed', 200)).toBe(50)
  })

  it('nunca es negativo', () => {
    expect(descuentoCupon(100, 'fixed', -20)).toBe(0)
  })
})
