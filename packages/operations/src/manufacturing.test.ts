import { describe, expect, it } from 'vitest'
import { ordenCompleta, tasaMerma, transicionValidaOrdenProduccion } from './manufacturing'

describe('transicionValidaOrdenProduccion', () => {
  it('draft libera o cancela', () => {
    expect(transicionValidaOrdenProduccion('draft', 'released')).toBe(true)
    expect(transicionValidaOrdenProduccion('draft', 'cancelled')).toBe(true)
  })

  it('released NO se cancela -ya consumio inventario-', () => {
    expect(transicionValidaOrdenProduccion('released', 'cancelled')).toBe(false)
  })

  it('released solo avanza a in_progress', () => {
    expect(transicionValidaOrdenProduccion('released', 'in_progress')).toBe(true)
  })

  it('in_progress solo completa', () => {
    expect(transicionValidaOrdenProduccion('in_progress', 'completed')).toBe(true)
    expect(transicionValidaOrdenProduccion('in_progress', 'cancelled')).toBe(false)
  })

  it('completed y cancelled son terminales', () => {
    expect(transicionValidaOrdenProduccion('completed', 'draft')).toBe(false)
    expect(transicionValidaOrdenProduccion('cancelled', 'draft')).toBe(false)
  })
})

describe('ordenCompleta', () => {
  it('todo completado, nada mermado: completa', () => {
    expect(ordenCompleta(100, 0, 100)).toBe(true)
  })

  it('parte completada parte mermada, cubre lo planificado: completa', () => {
    expect(ordenCompleta(90, 10, 100)).toBe(true)
  })

  it('todavia falta: no completa', () => {
    expect(ordenCompleta(50, 10, 100)).toBe(false)
  })
})

describe('tasaMerma', () => {
  it('sin nada procesado, cero -nunca divide entre cero-', () => {
    expect(tasaMerma(0, 0)).toBe(0)
  })

  it('10% de merma', () => {
    expect(tasaMerma(10, 90)).toBeCloseTo(0.1)
  })

  it('toda merma, ninguna produccion buena: 100%', () => {
    expect(tasaMerma(50, 0)).toBe(1)
  })
})
