import { describe, expect, it } from 'vitest'
import { montoFacturable, transicionValidaRegistroTiempo } from './timesheets.js'

describe('transicionValidaRegistroTiempo', () => {
  it('borrador avanza a enviado', () => {
    expect(transicionValidaRegistroTiempo('draft', 'submitted')).toBe(true)
  })

  it('enviado avanza a aprobado o rechazado', () => {
    expect(transicionValidaRegistroTiempo('submitted', 'approved')).toBe(true)
    expect(transicionValidaRegistroTiempo('submitted', 'rejected')).toBe(true)
  })

  it('rechazado se puede corregir y reenviar -no es terminal-', () => {
    expect(transicionValidaRegistroTiempo('rejected', 'draft')).toBe(true)
  })

  it('aprobado es terminal', () => {
    expect(transicionValidaRegistroTiempo('approved', 'draft')).toBe(false)
  })
})

describe('montoFacturable', () => {
  it('horas por tarifa cuando es facturable', () => {
    expect(montoFacturable(8, 25.5, true)).toBe(204)
  })

  it('cero cuando no es facturable', () => {
    expect(montoFacturable(8, 25.5, false)).toBe(0)
  })
})
