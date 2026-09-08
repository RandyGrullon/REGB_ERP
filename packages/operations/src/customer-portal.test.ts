import { describe, expect, it } from 'vitest'
import { transicionValidaInvitacion } from './customer-portal'

describe('transicionValidaInvitacion', () => {
  it('pending a active: valida', () => {
    expect(transicionValidaInvitacion('pending', 'active')).toBe(true)
  })

  it('pending a revoked: valida -se puede revocar antes de que la use-', () => {
    expect(transicionValidaInvitacion('pending', 'revoked')).toBe(true)
  })

  it('active a revoked: valida', () => {
    expect(transicionValidaInvitacion('active', 'revoked')).toBe(true)
  })

  it('revoked no va a ningun lado -terminal, no se reactiva-', () => {
    expect(transicionValidaInvitacion('revoked', 'active')).toBe(false)
  })

  it('active a pending: invalida -no retrocede-', () => {
    expect(transicionValidaInvitacion('active', 'pending')).toBe(false)
  })
})
