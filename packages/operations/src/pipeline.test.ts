import { describe, expect, it } from 'vitest'
import { diasEnEtapa, forecastPonderado, transicionValidaEtapa } from './pipeline'

describe('transicionValidaEtapa', () => {
  it('prospecting a qualification: valida', () => {
    expect(transicionValidaEtapa('prospecting', 'qualification')).toBe(true)
  })

  it('prospecting a proposal DIRECTO, saltandose qualification: invalida', () => {
    expect(transicionValidaEtapa('prospecting', 'proposal')).toBe(false)
  })

  it('lost se puede marcar desde cualquier etapa no terminal', () => {
    expect(transicionValidaEtapa('prospecting', 'lost')).toBe(true)
    expect(transicionValidaEtapa('negotiation', 'lost')).toBe(true)
  })

  it('won no va a ningun lado -terminal-', () => {
    expect(transicionValidaEtapa('won', 'prospecting')).toBe(false)
  })

  it('lost no va a ningun lado -terminal-', () => {
    expect(transicionValidaEtapa('lost', 'prospecting')).toBe(false)
  })

  it('negotiation a won: valida -ultimo paso-', () => {
    expect(transicionValidaEtapa('negotiation', 'won')).toBe(true)
  })
})

describe('forecastPonderado', () => {
  it('suma cada monto por su probabilidad', () => {
    expect(
      forecastPonderado([
        { amount: 1000, probability: 0.5 },
        { amount: 2000, probability: 0.25 },
      ]),
    ).toBe(1000)
  })

  it('sin oportunidades, cero', () => {
    expect(forecastPonderado([])).toBe(0)
  })
})

describe('diasEnEtapa (reutiliza diasEnPipeline de recruiting.ts)', () => {
  it('cuenta los dias transcurridos', () => {
    expect(diasEnEtapa(new Date('2026-01-01'), new Date('2026-01-11'))).toBe(10)
  })
})
