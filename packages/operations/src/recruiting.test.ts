import { describe, expect, it } from 'vitest'
import { diasEnPipeline, transicionValida } from './recruiting.js'

describe('transicionValida', () => {
  it('avanzar un paso en el orden normal es valido', () => {
    expect(transicionValida('applied', 'screening')).toBe(true)
    expect(transicionValida('screening', 'interview')).toBe(true)
    expect(transicionValida('interview', 'offer')).toBe(true)
    expect(transicionValida('offer', 'hired')).toBe(true)
  })

  it('saltar una etapa no es valido', () => {
    expect(transicionValida('applied', 'interview')).toBe(false)
    expect(transicionValida('applied', 'offer')).toBe(false)
  })

  it('retroceder no es valido', () => {
    expect(transicionValida('interview', 'screening')).toBe(false)
  })

  it('se puede rechazar desde cualquier etapa no terminal', () => {
    expect(transicionValida('applied', 'rejected')).toBe(true)
    expect(transicionValida('screening', 'rejected')).toBe(true)
    expect(transicionValida('offer', 'rejected')).toBe(true)
  })

  it('"hired" es terminal: no sale de ahi ni siquiera hacia "rejected"', () => {
    expect(transicionValida('hired', 'rejected')).toBe(false)
    expect(transicionValida('hired', 'applied')).toBe(false)
  })

  it('"rejected" es terminal: no sale de ahi', () => {
    expect(transicionValida('rejected', 'applied')).toBe(false)
    expect(transicionValida('rejected', 'screening')).toBe(false)
  })

  it('quedarse en la misma etapa no cuenta como avanzar', () => {
    expect(transicionValida('screening', 'screening')).toBe(false)
  })
})

describe('diasEnPipeline', () => {
  it('el mismo dia da cero', () => {
    const hoy = new Date(2026, 0, 15)
    expect(diasEnPipeline(hoy, hoy)).toBe(0)
  })

  it('cuenta los dias transcurridos', () => {
    const aplico = new Date(2026, 0, 1)
    const hoy = new Date(2026, 0, 15)
    expect(diasEnPipeline(aplico, hoy)).toBe(14)
  })

  it('nunca da un numero negativo, aunque las fechas esten invertidas', () => {
    const aplico = new Date(2026, 0, 15)
    const hoy = new Date(2026, 0, 1)
    expect(diasEnPipeline(aplico, hoy)).toBe(0)
  })
})
