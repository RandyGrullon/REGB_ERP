import { describe, expect, it } from 'vitest'
import { fuenteValida, proximaEjecucion } from './bi.js'

describe('proximaEjecucion', () => {
  it('diaria suma un dia', () => {
    const d = proximaEjecucion(new Date('2026-03-10T08:00:00Z'), 'daily')
    expect(d.toISOString().slice(0, 10)).toBe('2026-03-11')
  })

  it('semanal suma siete dias', () => {
    const d = proximaEjecucion(new Date('2026-03-10T08:00:00Z'), 'weekly')
    expect(d.toISOString().slice(0, 10)).toBe('2026-03-17')
  })

  it('mensual mantiene el mismo dia del mes', () => {
    const d = proximaEjecucion(new Date('2026-03-15T08:00:00Z'), 'monthly')
    expect(d.toISOString().slice(0, 10)).toBe('2026-04-15')
  })

  it('mensual se ajusta al ultimo dia si el mes siguiente es mas corto', () => {
    const d = proximaEjecucion(new Date('2026-01-31T08:00:00Z'), 'monthly')
    expect(d.toISOString().slice(0, 10)).toBe('2026-02-28')
  })
})

describe('fuenteValida', () => {
  it('acepta las fuentes conocidas', () => {
    expect(fuenteValida('sales_by_day')).toBe(true)
    expect(fuenteValida('top_products')).toBe(true)
  })

  it('rechaza una fuente inventada', () => {
    expect(fuenteValida('algo_inventado')).toBe(false)
  })
})
