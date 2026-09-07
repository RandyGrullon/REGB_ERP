import { describe, expect, it } from 'vitest'
import { aproboEvaluacion, certificadoVigente, nivelPromedioCompetencia } from './training.js'

describe('aproboEvaluacion', () => {
  it('una nota igual al minimo aprueba', () => {
    expect(aproboEvaluacion(70, 70)).toBe(true)
  })

  it('una nota por debajo del minimo no aprueba', () => {
    expect(aproboEvaluacion(69, 70)).toBe(false)
  })

  it('respeta un minimo distinto por curso', () => {
    expect(aproboEvaluacion(85, 90)).toBe(false)
    expect(aproboEvaluacion(95, 90)).toBe(true)
  })
})

describe('certificadoVigente', () => {
  it('sin fecha de vencimiento, siempre esta vigente', () => {
    expect(certificadoVigente(null, new Date(2099, 0, 1))).toBe(true)
  })

  it('antes de vencer, esta vigente', () => {
    const vence = new Date(2026, 11, 31)
    const hoy = new Date(2026, 0, 1)
    expect(certificadoVigente(vence, hoy)).toBe(true)
  })

  it('despues de vencer, ya no esta vigente', () => {
    const vence = new Date(2026, 0, 1)
    const hoy = new Date(2026, 11, 31)
    expect(certificadoVigente(vence, hoy)).toBe(false)
  })
})

describe('nivelPromedioCompetencia', () => {
  it('promedia los niveles registrados', () => {
    expect(nivelPromedioCompetencia([3, 4, 5])).toBe(4)
  })

  it('sin nadie evaluado todavia, no hay promedio', () => {
    expect(nivelPromedioCompetencia([])).toBeNull()
  })
})
