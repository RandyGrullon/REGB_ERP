import { describe, expect, it } from 'vitest'
import { capacidadDisponible, estaSobrecargado, porcentajeUtilizacion } from './resources.js'

describe('capacidadDisponible', () => {
  it('lo que sobra de la semana', () => {
    expect(capacidadDisponible(40, 32)).toBe(8)
  })

  it('nunca negativo aunque este sobrecargado', () => {
    expect(capacidadDisponible(40, 52)).toBe(0)
  })
})

describe('estaSobrecargado', () => {
  it('llenar la capacidad exacta NO es sobrecarga', () => {
    expect(estaSobrecargado(40, 40)).toBe(false)
  })

  it('pasarse si lo es', () => {
    expect(estaSobrecargado(40, 40.5)).toBe(true)
  })
})

describe('porcentajeUtilizacion (reusa tasaSobre de marketing.ts)', () => {
  it('fraccion de la capacidad usada', () => {
    expect(porcentajeUtilizacion(30, 40)).toBe(0.75)
  })

  it('null sin capacidad definida -no es cero-', () => {
    expect(porcentajeUtilizacion(10, 0)).toBeNull()
  })
})
