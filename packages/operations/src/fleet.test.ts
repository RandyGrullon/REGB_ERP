import { describe, expect, it } from 'vitest'
import {
  eficienciaCombustible,
  mantenimientoVencidoPorFecha,
  mantenimientoVencidoPorKm,
  transicionValidaMulta,
} from './fleet'

describe('eficienciaCombustible', () => {
  it('calcula km por litro', () => {
    expect(eficienciaCombustible(400, 40)).toBe(10)
  })

  it('sin litros, cero -nunca divide entre cero-', () => {
    expect(eficienciaCombustible(400, 0)).toBe(0)
  })
})

describe('mantenimientoVencidoPorKm', () => {
  it('dentro del intervalo: no vencido', () => {
    expect(mantenimientoVencidoPorKm(15000, 10000, 10000)).toBe(false)
  })

  it('ya alcanzo el intervalo: vencido', () => {
    expect(mantenimientoVencidoPorKm(20000, 10000, 10000)).toBe(true)
  })

  it('exactamente en el limite: vencido', () => {
    expect(mantenimientoVencidoPorKm(20000, 10000, 10000)).toBe(true)
  })
})

describe('mantenimientoVencidoPorFecha', () => {
  it('todavia falta: no vencido', () => {
    expect(mantenimientoVencidoPorFecha(new Date('2026-12-01'), new Date('2026-06-01'))).toBe(false)
  })

  it('ya paso la fecha: vencido', () => {
    expect(mantenimientoVencidoPorFecha(new Date('2026-01-01'), new Date('2026-06-01'))).toBe(true)
  })
})

describe('transicionValidaMulta', () => {
  it('pending se paga o se disputa', () => {
    expect(transicionValidaMulta('pending', 'paid')).toBe(true)
    expect(transicionValidaMulta('pending', 'disputed')).toBe(true)
  })

  it('disputed se paga o se descarta', () => {
    expect(transicionValidaMulta('disputed', 'paid')).toBe(true)
    expect(transicionValidaMulta('disputed', 'dismissed')).toBe(true)
  })

  it('paid y dismissed son terminales', () => {
    expect(transicionValidaMulta('paid', 'pending')).toBe(false)
    expect(transicionValidaMulta('dismissed', 'pending')).toBe(false)
  })

  it('no se puede saltar de pending a dismissed sin pasar por disputed', () => {
    expect(transicionValidaMulta('pending', 'dismissed')).toBe(false)
  })
})
