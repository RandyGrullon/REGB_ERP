import { describe, expect, it } from 'vitest'
import { accionValida, condicionCumple, tipoEventoValido } from './automations.js'

describe('condicionCumple', () => {
  it('eq compara texto exacto', () => {
    expect(condicionCumple('urgent', 'eq', 'urgent')).toBe(true)
    expect(condicionCumple('high', 'eq', 'urgent')).toBe(false)
  })

  it('neq es lo contrario de eq', () => {
    expect(condicionCumple('high', 'neq', 'urgent')).toBe(true)
  })

  it('gt/lt comparan numerico cuando ambos lo son', () => {
    expect(condicionCumple('100', 'gt', '50')).toBe(true)
    expect(condicionCumple('30', 'lt', '50')).toBe(true)
    expect(condicionCumple('30', 'gt', '50')).toBe(false)
  })

  it('gt/lt caen a texto si no son numericos', () => {
    expect(condicionCumple('zebra', 'gt', 'arbol')).toBe(true)
  })
})

describe('accionValida', () => {
  it('acepta las acciones conocidas', () => {
    expect(accionValida('create_notification')).toBe(true)
  })

  it('rechaza una accion inventada', () => {
    expect(accionValida('ejecutar_codigo_libre')).toBe(false)
  })
})

describe('tipoEventoValido', () => {
  it('acepta el formato modulo.entidad.accion', () => {
    expect(tipoEventoValido('helpdesk.ticket.resolved')).toBe(true)
  })

  it('rechaza un tipo sin los tres segmentos', () => {
    expect(tipoEventoValido('helpdesk.resolved')).toBe(false)
  })
})
