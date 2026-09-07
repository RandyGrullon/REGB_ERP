import { describe, expect, it } from 'vitest'
import { progresoObjetivo, progresoResultadoClave, promedioEvaluacion360 } from './performance.js'

describe('progresoResultadoClave', () => {
  it('a mitad de camino da 50%', () => {
    expect(progresoResultadoClave(5, 10)).toBe(50)
  })

  it('llegar a la meta da 100%', () => {
    expect(progresoResultadoClave(10, 10)).toBe(100)
  })

  it('pasarse de la meta nunca da mas de 100%', () => {
    expect(progresoResultadoClave(15, 10)).toBe(100)
  })

  it('un valor negativo nunca da menos de 0%', () => {
    expect(progresoResultadoClave(-5, 10)).toBe(0)
  })

  it('una meta de cero ya cumplida -current tambien cero- cuenta como 100%', () => {
    expect(progresoResultadoClave(0, 0)).toBe(100)
  })

  it('una meta de cero sin cumplir -current distinto de cero- no divide por cero', () => {
    expect(progresoResultadoClave(5, 0)).toBe(0)
  })
})

describe('progresoObjetivo', () => {
  it('el progreso es el promedio de sus resultados clave', () => {
    const krs = [
      { current: 10, target: 10 }, // 100%
      { current: 0, target: 10 }, // 0%
    ]
    expect(progresoObjetivo(krs)).toBe(50)
  })

  it('un objetivo sin resultados clave todavia no tiene progreso', () => {
    expect(progresoObjetivo([])).toBe(0)
  })
})

describe('promedioEvaluacion360', () => {
  it('promedia las calificaciones de todos los que evaluaron', () => {
    expect(promedioEvaluacion360([5, 4, 3, 4])).toBe(4)
  })

  it('sin ninguna calificacion todavia, no hay promedio', () => {
    expect(promedioEvaluacion360([])).toBeNull()
  })
})
