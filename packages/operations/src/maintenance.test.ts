import { describe, expect, it } from 'vitest'
import {
  calcularMtbfDias,
  equipoRequiereMantenimiento,
  transicionValidaOrdenTrabajo,
} from './maintenance'

describe('transicionValidaOrdenTrabajo', () => {
  it('open a in_progress: valida', () => {
    expect(transicionValidaOrdenTrabajo('open', 'in_progress')).toBe(true)
  })

  it('open a cancelled: valida', () => {
    expect(transicionValidaOrdenTrabajo('open', 'cancelled')).toBe(true)
  })

  it('in_progress a completed: valida', () => {
    expect(transicionValidaOrdenTrabajo('in_progress', 'completed')).toBe(true)
  })

  it('completed no va a ningun lado -terminal-', () => {
    expect(transicionValidaOrdenTrabajo('completed', 'open')).toBe(false)
  })

  it('open a completed DIRECTO, saltandose in_progress: invalida', () => {
    expect(transicionValidaOrdenTrabajo('open', 'completed')).toBe(false)
  })
})

describe('calcularMtbfDias', () => {
  it('promedia los intervalos ENTRE fallas consecutivas, no desde la primera hasta hoy', () => {
    const fechas = [new Date('2026-01-01'), new Date('2026-01-11'), new Date('2026-01-31')]
    // 10 dias + 20 dias, entre dos intervalos = 15
    expect(calcularMtbfDias(fechas)).toBe(15)
  })

  it('funciona sin importar el orden de entrada', () => {
    const fechas = [new Date('2026-01-31'), new Date('2026-01-01'), new Date('2026-01-11')]
    expect(calcularMtbfDias(fechas)).toBe(15)
  })

  it('con menos de dos fallas, no hay MTBF que calcular', () => {
    expect(calcularMtbfDias([new Date('2026-01-01')])).toBeNull()
    expect(calcularMtbfDias([])).toBeNull()
  })
})

describe('equipoRequiereMantenimiento', () => {
  it('vencido por uso acumulado', () => {
    expect(equipoRequiereMantenimiento(1000, 0, 500, null, new Date())).toBe(true)
  })

  it('vencido por fecha limite', () => {
    expect(
      equipoRequiereMantenimiento(100, 0, 500, new Date('2026-01-01'), new Date('2026-06-01')),
    ).toBe(true)
  })

  it('ni por uso ni por fecha: no hace falta todavia', () => {
    expect(
      equipoRequiereMantenimiento(100, 0, 500, new Date('2026-12-01'), new Date('2026-06-01')),
    ).toBe(false)
  })

  it('sin fecha limite declarada, solo importa el uso', () => {
    expect(equipoRequiereMantenimiento(100, 0, 500, null, new Date())).toBe(false)
  })
})
