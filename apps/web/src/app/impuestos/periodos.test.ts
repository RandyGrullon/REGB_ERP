import { describe, expect, it } from 'vitest'
import { opcionesDePeriodo, periodoLegible } from './periodos'

describe('periodoLegible', () => {
  it('solo la primera letra en mayúscula, no "Agosto De 2026"', () => {
    expect(periodoLegible('202608')).toBe('Agosto de 2026')
  })
})

describe('opcionesDePeriodo', () => {
  // 30 de septiembre de 2026, mediodía en RD.
  const hoy = new Date('2026-09-30T16:00:00Z')

  it('del mes que viene hacia atrás, en AAAAMM y en español', () => {
    const o = opcionesDePeriodo(hoy, '202608')
    expect(o[0]).toEqual({ valor: '202610', texto: 'Octubre de 2026' })
    expect(o[1]!.valor).toBe('202609')
    expect(o[2]).toEqual({ valor: '202608', texto: 'Agosto de 2026' })
    expect(o).toHaveLength(20)
  })

  it('un período viejo de un enlace se agrega, sin duplicar', () => {
    const o = opcionesDePeriodo(hoy, '202401')
    expect(o.at(-1)!.valor).toBe('202401')
    expect(new Set(o.map((x) => x.valor)).size).toBe(o.length)
  })
})
