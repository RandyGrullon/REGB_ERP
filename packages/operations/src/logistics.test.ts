import { describe, expect, it } from 'vitest'
import { rutaCompleta, tasaEntregaExitosa, transicionValidaRuta } from './logistics'

describe('transicionValidaRuta', () => {
  it('planned despacha o cancela', () => {
    expect(transicionValidaRuta('planned', 'in_progress')).toBe(true)
    expect(transicionValidaRuta('planned', 'cancelled')).toBe(true)
  })

  it('in_progress solo completa', () => {
    expect(transicionValidaRuta('in_progress', 'completed')).toBe(true)
    expect(transicionValidaRuta('in_progress', 'cancelled')).toBe(false)
  })

  it('completed y cancelled son terminales', () => {
    expect(transicionValidaRuta('completed', 'planned')).toBe(false)
    expect(transicionValidaRuta('cancelled', 'planned')).toBe(false)
  })
})

describe('rutaCompleta', () => {
  it('sin paradas, no esta completa', () => {
    expect(rutaCompleta([])).toBe(false)
  })

  it('con una pendiente, no esta completa', () => {
    expect(rutaCompleta([{ status: 'delivered' }, { status: 'pending' }])).toBe(false)
  })

  it('todas resueltas -entregadas o fallidas-, completa', () => {
    expect(rutaCompleta([{ status: 'delivered' }, { status: 'failed' }])).toBe(true)
  })
})

describe('tasaEntregaExitosa', () => {
  it('sin paradas resueltas, cero', () => {
    expect(tasaEntregaExitosa([{ status: 'pending' }])).toBe(0)
  })

  it('todas entregadas, 100%', () => {
    expect(tasaEntregaExitosa([{ status: 'delivered' }, { status: 'delivered' }])).toBe(1)
  })

  it('mitad entregada mitad fallida, 50%', () => {
    expect(tasaEntregaExitosa([{ status: 'delivered' }, { status: 'failed' }])).toBe(0.5)
  })

  it('las pendientes no cuentan ni para arriba ni para abajo', () => {
    expect(
      tasaEntregaExitosa([{ status: 'delivered' }, { status: 'failed' }, { status: 'pending' }]),
    ).toBe(0.5)
  })
})
