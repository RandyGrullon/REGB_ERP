import { describe, expect, it } from 'vitest'
import { calcularComision, transicionValidaComision } from './commissions'

describe('calcularComision', () => {
  it('esquema porcentaje: aplica la tasa sobre la base', () => {
    expect(calcularComision(10000, 0.05, 'percentage')).toBe(500)
  })

  it('esquema fijo: ignora la base, usa la tasa tal cual', () => {
    expect(calcularComision(10000, 250, 'fixed')).toBe(250)
  })
})

describe('transicionValidaComision', () => {
  it('pending a approved: valida', () => {
    expect(transicionValidaComision('pending', 'approved')).toBe(true)
  })

  it('pending a rejected: valida', () => {
    expect(transicionValidaComision('pending', 'rejected')).toBe(true)
  })

  it('pending a paid DIRECTO, saltandose approved: invalida', () => {
    expect(transicionValidaComision('pending', 'paid')).toBe(false)
  })

  it('approved a paid: valida', () => {
    expect(transicionValidaComision('approved', 'paid')).toBe(true)
  })

  it('paid no va a ningun lado -terminal-', () => {
    expect(transicionValidaComision('paid', 'pending')).toBe(false)
  })

  it('rejected no va a ningun lado -terminal-', () => {
    expect(transicionValidaComision('rejected', 'approved')).toBe(false)
  })
})
