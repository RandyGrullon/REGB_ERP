import { describe, expect, it } from 'vitest'
import {
  diasAbierto,
  resultadoInspeccion,
  tasaAprobacionCriterios,
  transicionValidaCapa,
  transicionValidaNoConformidad,
} from './quality'

describe('resultadoInspeccion', () => {
  it('todos aprobados: pasa', () => {
    expect(
      resultadoInspeccion([
        { aprobado: true, esCritico: true },
        { aprobado: true, esCritico: false },
      ]),
    ).toBe('passed')
  })

  it('un criterio menor reprobado: condicional, no reprobada de plano', () => {
    expect(
      resultadoInspeccion([
        { aprobado: true, esCritico: true },
        { aprobado: false, esCritico: false },
      ]),
    ).toBe('conditional')
  })

  it('un criterio critico reprobado: reprueba entera, aunque los demas pasen', () => {
    expect(
      resultadoInspeccion([
        { aprobado: false, esCritico: true },
        { aprobado: true, esCritico: false },
      ]),
    ).toBe('failed')
  })

  it('sin criterios: pasa por defecto', () => {
    expect(resultadoInspeccion([])).toBe('passed')
  })
})

describe('tasaAprobacionCriterios', () => {
  it('calcula la proporcion aprobada', () => {
    expect(
      tasaAprobacionCriterios([
        { aprobado: true, esCritico: false },
        { aprobado: true, esCritico: false },
        { aprobado: false, esCritico: false },
        { aprobado: false, esCritico: false },
      ]),
    ).toBe(0.5)
  })

  it('sin criterios, 100% -nada que reprobar-', () => {
    expect(tasaAprobacionCriterios([])).toBe(1)
  })
})

describe('transicionValidaNoConformidad', () => {
  it('open a investigating: valida', () => {
    expect(transicionValidaNoConformidad('open', 'investigating')).toBe(true)
  })

  it('open a dismissed: valida -se puede descartar sin investigar-', () => {
    expect(transicionValidaNoConformidad('open', 'dismissed')).toBe(true)
  })

  it('investigating a closed DIRECTO: invalida -tiene que pasar por un CAPA-', () => {
    expect(transicionValidaNoConformidad('investigating', 'closed')).toBe(false)
  })

  it('capa_created a closed: valida', () => {
    expect(transicionValidaNoConformidad('capa_created', 'closed')).toBe(true)
  })

  it('closed no va a ningun lado', () => {
    expect(transicionValidaNoConformidad('closed', 'open')).toBe(false)
  })
})

describe('transicionValidaCapa', () => {
  it('open a in_progress: valida', () => {
    expect(transicionValidaCapa('open', 'in_progress')).toBe(true)
  })

  it('in_progress a closed DIRECTO: invalida -tiene que verificarse primero-', () => {
    expect(transicionValidaCapa('in_progress', 'closed')).toBe(false)
  })

  it('verified a closed: valida', () => {
    expect(transicionValidaCapa('verified', 'closed')).toBe(true)
  })

  it('open a verified, saltandose in_progress: invalida', () => {
    expect(transicionValidaCapa('open', 'verified')).toBe(false)
  })
})

describe('diasAbierto', () => {
  it('cuenta los dias completos transcurridos', () => {
    expect(diasAbierto(new Date('2026-01-01'), new Date('2026-01-11'))).toBe(10)
  })

  it('nunca negativo, aunque la fecha este en el futuro', () => {
    expect(diasAbierto(new Date('2026-06-01'), new Date('2026-01-01'))).toBe(0)
  })
})
