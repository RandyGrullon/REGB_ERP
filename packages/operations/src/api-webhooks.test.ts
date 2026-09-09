import { describe, expect, it } from 'vitest'
import { limiteExcedido, tipoEventoValido } from './api-webhooks.js'

describe('limiteExcedido', () => {
  it('no excede mientras quede margen', () => {
    expect(limiteExcedido(30, 60)).toBe(false)
  })

  it('excede al llegar exactamente al limite', () => {
    expect(limiteExcedido(60, 60)).toBe(true)
  })

  it('excede por encima del limite', () => {
    expect(limiteExcedido(90, 60)).toBe(true)
  })
})

describe('tipoEventoValido (reexportado de automations.ts)', () => {
  it('acepta el formato modulo.entidad.accion', () => {
    expect(tipoEventoValido('sales-orders.order.confirmed')).toBe(true)
  })

  it('rechaza un tipo invalido', () => {
    expect(tipoEventoValido('*')).toBe(false)
  })
})
