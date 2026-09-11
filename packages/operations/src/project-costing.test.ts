import { describe, expect, it } from 'vitest'
import { avanceSobrePresupuesto, desviacion, margen, trabajoEnCurso } from './project-costing.js'

describe('desviacion', () => {
  it('positiva cuando se gasta de mas', () => {
    expect(desviacion(100_000, 118_500)).toBe(18_500)
  })

  it('negativa cuando se gasta de menos', () => {
    expect(desviacion(100_000, 82_000)).toBe(-18_000)
  })
})

describe('margen', () => {
  it('fraccion del presupuesto que sobra', () => {
    expect(margen(100_000, 75_000)).toBe(0.25)
  })

  it('negativo cuando el real supera el presupuesto', () => {
    expect(margen(100_000, 120_000)).toBe(-0.2)
  })

  it('null sin presupuesto contra que comparar -no es cero-', () => {
    expect(margen(0, 5_000)).toBeNull()
  })
})

describe('trabajoEnCurso', () => {
  it('lo gastado que todavia no se factura', () => {
    expect(trabajoEnCurso(80_000, 50_000)).toBe(30_000)
  })

  it('nunca negativo: facturar de mas no crea una deuda de WIP', () => {
    expect(trabajoEnCurso(50_000, 80_000)).toBe(0)
  })
})

describe('avanceSobrePresupuesto (reusa tasaSobre de marketing.ts)', () => {
  it('fraccion consumida del presupuesto', () => {
    expect(avanceSobrePresupuesto(45_000, 90_000)).toBe(0.5)
  })

  it('null sin presupuesto', () => {
    expect(avanceSobrePresupuesto(1_000, 0)).toBeNull()
  })
})
