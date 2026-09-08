import { describe, expect, it } from 'vitest'
import { transicionValidaFirma } from './esign'

describe('transicionValidaFirma', () => {
  it('pending a sent: valida', () => {
    expect(transicionValidaFirma('pending', 'sent')).toBe(true)
  })

  it('pending a signed DIRECTO, saltandose sent: invalida', () => {
    expect(transicionValidaFirma('pending', 'signed')).toBe(false)
  })

  it('sent a signed: valida', () => {
    expect(transicionValidaFirma('sent', 'signed')).toBe(true)
  })

  it('sent a declined: valida', () => {
    expect(transicionValidaFirma('sent', 'declined')).toBe(true)
  })

  it('sent a expired: valida', () => {
    expect(transicionValidaFirma('sent', 'expired')).toBe(true)
  })

  it('signed no va a ningun lado -terminal-', () => {
    expect(transicionValidaFirma('signed', 'sent')).toBe(false)
  })

  it('declined no va a ningun lado -terminal-', () => {
    expect(transicionValidaFirma('declined', 'sent')).toBe(false)
  })
})
