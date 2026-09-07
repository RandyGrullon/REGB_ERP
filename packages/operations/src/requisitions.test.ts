import { describe, expect, it } from 'vitest'
import { transicionValidaRequisicion } from './requisitions.js'

describe('transicionValidaRequisicion', () => {
  it('de borrador solo se puede pasar a pendiente', () => {
    expect(transicionValidaRequisicion('draft', 'pending')).toBe(true)
    expect(transicionValidaRequisicion('draft', 'approved')).toBe(false)
  })

  it('de pendiente se puede aprobar o rechazar', () => {
    expect(transicionValidaRequisicion('pending', 'approved')).toBe(true)
    expect(transicionValidaRequisicion('pending', 'rejected')).toBe(true)
  })

  it('de pendiente no se puede volver a borrador', () => {
    expect(transicionValidaRequisicion('pending', 'draft')).toBe(false)
  })

  it('solo aprobada puede convertirse en orden', () => {
    expect(transicionValidaRequisicion('approved', 'converted')).toBe(true)
    expect(transicionValidaRequisicion('pending', 'converted')).toBe(false)
    expect(transicionValidaRequisicion('rejected', 'converted')).toBe(false)
  })

  it('rechazada es terminal', () => {
    expect(transicionValidaRequisicion('rejected', 'pending')).toBe(false)
    expect(transicionValidaRequisicion('rejected', 'approved')).toBe(false)
  })

  it('convertida es terminal', () => {
    expect(transicionValidaRequisicion('converted', 'approved')).toBe(false)
  })
})
