import { describe, expect, it } from 'vitest'
import { transicionValidaCotizacion } from './quotes'

describe('transicionValidaCotizacion', () => {
  it('draft a sent: valida', () => {
    expect(transicionValidaCotizacion('draft', 'sent')).toBe(true)
  })

  it('draft a approved DIRECTO, saltandose sent: invalida', () => {
    expect(transicionValidaCotizacion('draft', 'approved')).toBe(false)
  })

  it('sent a approved: valida', () => {
    expect(transicionValidaCotizacion('sent', 'approved')).toBe(true)
  })

  it('sent a rejected: valida', () => {
    expect(transicionValidaCotizacion('sent', 'rejected')).toBe(true)
  })

  it('sent a expired: valida', () => {
    expect(transicionValidaCotizacion('sent', 'expired')).toBe(true)
  })

  it('approved no va a ningun lado -terminal-', () => {
    expect(transicionValidaCotizacion('approved', 'sent')).toBe(false)
  })

  it('nadie llega a superseded por esta funcion -se pone directo al crear una version nueva-', () => {
    expect(transicionValidaCotizacion('draft', 'superseded')).toBe(false)
    expect(transicionValidaCotizacion('sent', 'superseded')).toBe(false)
  })
})
