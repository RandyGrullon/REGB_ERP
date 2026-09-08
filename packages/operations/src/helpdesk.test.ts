import { describe, expect, it } from 'vitest'
import { diasTicketAbierto, slaVigente, transicionValidaTicket } from './helpdesk'

describe('transicionValidaTicket', () => {
  it('open a in_progress: valida', () => {
    expect(transicionValidaTicket('open', 'in_progress')).toBe(true)
  })

  it('open a resolved DIRECTO, saltandose in_progress: invalida', () => {
    expect(transicionValidaTicket('open', 'resolved')).toBe(false)
  })

  it('in_progress a waiting_customer: valida', () => {
    expect(transicionValidaTicket('in_progress', 'waiting_customer')).toBe(true)
  })

  it('waiting_customer a in_progress: valida -el cliente respondio-', () => {
    expect(transicionValidaTicket('waiting_customer', 'in_progress')).toBe(true)
  })

  it('resolved SI se puede reabrir a in_progress', () => {
    expect(transicionValidaTicket('resolved', 'in_progress')).toBe(true)
  })

  it('resolved a closed: valida', () => {
    expect(transicionValidaTicket('resolved', 'closed')).toBe(true)
  })

  it('closed no va a ningun lado -terminal de verdad-', () => {
    expect(transicionValidaTicket('closed', 'in_progress')).toBe(false)
  })
})

describe('slaVigente (reutiliza certificadoVigente de training.ts)', () => {
  it('dentro del plazo, vigente', () => {
    expect(slaVigente(new Date('2026-06-01'), new Date('2026-01-01'))).toBe(true)
  })

  it('pasado el plazo, no vigente', () => {
    expect(slaVigente(new Date('2026-01-01'), new Date('2026-06-01'))).toBe(false)
  })
})

describe('diasTicketAbierto (reutiliza diasAbierto de quality.ts)', () => {
  it('cuenta los dias completos transcurridos', () => {
    expect(diasTicketAbierto(new Date('2026-01-01'), new Date('2026-01-11'))).toBe(10)
  })
})
