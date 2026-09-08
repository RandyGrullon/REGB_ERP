import { describe, expect, it } from 'vitest'
import { calcularEscalamiento, transicionValidaContrato } from './contracts'

describe('transicionValidaContrato', () => {
  it('draft a active: valida', () => {
    expect(transicionValidaContrato('draft', 'active')).toBe(true)
  })

  it('draft a renewed DIRECTO, saltandose active: invalida', () => {
    expect(transicionValidaContrato('draft', 'renewed')).toBe(false)
  })

  it('active a renewed: valida', () => {
    expect(transicionValidaContrato('active', 'renewed')).toBe(true)
  })

  it('active a cancelled: valida', () => {
    expect(transicionValidaContrato('active', 'cancelled')).toBe(true)
  })

  it('active a expired: valida', () => {
    expect(transicionValidaContrato('active', 'expired')).toBe(true)
  })

  it('renewed no va a ningun lado -terminal, la renovacion crea un contrato nuevo-', () => {
    expect(transicionValidaContrato('renewed', 'active')).toBe(false)
  })

  it('cancelled no va a ningun lado -terminal-', () => {
    expect(transicionValidaContrato('cancelled', 'active')).toBe(false)
  })
})

describe('calcularEscalamiento', () => {
  it('aplica el porcentaje de escalamiento sobre el monto base', () => {
    expect(calcularEscalamiento(1000, 0.1)).toBe(1100)
  })

  it('sin escalamiento, el monto queda igual', () => {
    expect(calcularEscalamiento(1000, 0)).toBe(1000)
  })
})
