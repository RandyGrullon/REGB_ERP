import { describe, expect, it } from 'vitest'
import { mejorCotizacion } from './rfq.js'

describe('mejorCotizacion', () => {
  it('sin ninguna cotizacion, no hay ganador', () => {
    expect(mejorCotizacion([])).toBeNull()
  })

  it('gana el monto mas bajo', () => {
    const cotizaciones = [
      { supplierId: 'a', totalAmount: 1000, leadTimeDays: 5 },
      { supplierId: 'b', totalAmount: 900, leadTimeDays: 7 },
      { supplierId: 'c', totalAmount: 1100, leadTimeDays: 3 },
    ]
    expect(mejorCotizacion(cotizaciones)).toBe('b')
  })

  it('en un empate de monto, gana el plazo de entrega mas corto', () => {
    const cotizaciones = [
      { supplierId: 'a', totalAmount: 1000, leadTimeDays: 10 },
      { supplierId: 'b', totalAmount: 1000, leadTimeDays: 4 },
    ]
    expect(mejorCotizacion(cotizaciones)).toBe('b')
  })

  it('con una sola cotizacion, esa gana', () => {
    expect(mejorCotizacion([{ supplierId: 'solo', totalAmount: 500, leadTimeDays: 2 }])).toBe('solo')
  })
})
