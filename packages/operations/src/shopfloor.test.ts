import { describe, expect, it } from 'vitest'
import { calcularOee, calidadOee, disponibilidad, horasInactivoTotal, rendimiento } from './shopfloor'

describe('disponibilidad', () => {
  it('sin paro, 100%', () => {
    expect(disponibilidad(8, 0)).toBe(1)
  })

  it('con paro, resta del planificado', () => {
    expect(disponibilidad(8, 2)).toBe(0.75)
  })

  it('sin tiempo planificado, cero -nunca divide entre cero-', () => {
    expect(disponibilidad(0, 0)).toBe(0)
  })

  it('un paro mayor que lo planificado no baja de cero', () => {
    expect(disponibilidad(8, 10)).toBe(0)
  })
})

describe('rendimiento', () => {
  it('al ciclo ideal exacto, 100%', () => {
    // 10 unidades a 0.5 horas ideales cada una = 5 horas ideales, en 5 horas reales
    expect(rendimiento(10, 5, 0.5)).toBe(1)
  })

  it('mas lento que el ciclo ideal, menos de 100%', () => {
    expect(rendimiento(10, 10, 0.5)).toBe(0.5)
  })

  it('un ciclo ideal mal estimado no infla el numero mas alla de 100%', () => {
    expect(rendimiento(10, 2, 0.5)).toBe(1)
  })

  it('sin horas operando, cero -nunca divide entre cero-', () => {
    expect(rendimiento(10, 0, 0.5)).toBe(0)
  })
})

describe('calidadOee', () => {
  it('sin merma, 100%', () => {
    expect(calidadOee(0, 100)).toBe(1)
  })

  it('con merma, resta la proporcion mermada', () => {
    expect(calidadOee(10, 90)).toBe(0.9)
  })
})

describe('calcularOee', () => {
  it('multiplica los tres factores', () => {
    expect(calcularOee(0.9, 0.8, 0.95)).toBeCloseTo(0.684, 5)
  })

  it('recorta cada factor a [0,1] antes de multiplicar', () => {
    expect(calcularOee(1.5, 0.5, 1)).toBe(0.5)
  })
})

describe('horasInactivoTotal', () => {
  it('suma solo los eventos ya cerrados', () => {
    const eventos = [
      { startedAt: new Date('2026-01-01T08:00:00'), endedAt: new Date('2026-01-01T09:00:00') },
      { startedAt: new Date('2026-01-01T10:00:00'), endedAt: new Date('2026-01-01T10:30:00') },
      { startedAt: new Date('2026-01-01T11:00:00'), endedAt: null },
    ]
    expect(horasInactivoTotal(eventos)).toBe(1.5)
  })

  it('sin ningun evento cerrado, cero', () => {
    expect(horasInactivoTotal([{ startedAt: new Date(), endedAt: null }])).toBe(0)
  })
})
