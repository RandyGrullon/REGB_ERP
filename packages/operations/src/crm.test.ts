import { describe, expect, it } from 'vitest'
import { asignarRoundRobin, puntuarLead, transicionValidaLead } from './crm'

describe('transicionValidaLead', () => {
  it('new a contacted: valida', () => {
    expect(transicionValidaLead('new', 'contacted')).toBe(true)
  })

  it('new a disqualified: valida -se puede descalificar de entrada-', () => {
    expect(transicionValidaLead('new', 'disqualified')).toBe(true)
  })

  it('new a qualified DIRECTO, saltandose contacted: invalida', () => {
    expect(transicionValidaLead('new', 'qualified')).toBe(false)
  })

  it('converted no va a ningun lado -terminal-', () => {
    expect(transicionValidaLead('converted', 'contacted')).toBe(false)
  })

  it('disqualified no va a ningun lado -terminal-', () => {
    expect(transicionValidaLead('disqualified', 'new')).toBe(false)
  })
})

describe('puntuarLead', () => {
  it('email + telefono + referral: puntaje maximo', () => {
    expect(puntuarLead({ tieneEmail: true, tieneTelefono: true, fuente: 'referral' })).toBe(100)
  })

  it('solo email, fuente fria: puntaje bajo', () => {
    expect(puntuarLead({ tieneEmail: true, tieneTelefono: false, fuente: 'cold' })).toBe(50)
  })

  it('sin nada de contacto, fuente web: solo el peso de la fuente', () => {
    expect(puntuarLead({ tieneEmail: false, tieneTelefono: false, fuente: 'web' })).toBe(20)
  })

  it('nunca pasa de 100', () => {
    expect(puntuarLead({ tieneEmail: true, tieneTelefono: true, fuente: 'referral' })).toBeLessThanOrEqual(100)
  })
})

describe('asignarRoundRobin', () => {
  it('reparte en orden, empezando despues del ultimo indice', () => {
    const asignaciones = asignarRoundRobin(['l1', 'l2', 'l3'], ['vA', 'vB'], 0)
    expect(asignaciones).toEqual([
      { leadId: 'l1', vendedorId: 'vB' },
      { leadId: 'l2', vendedorId: 'vA' },
      { leadId: 'l3', vendedorId: 'vB' },
    ])
  })

  it('sin vendedores, no asigna nada', () => {
    expect(asignarRoundRobin(['l1'], [], -1)).toEqual([])
  })

  it('da la vuelta completa y sigue repartiendo por igual', () => {
    const asignaciones = asignarRoundRobin(['l1', 'l2', 'l3', 'l4'], ['vA', 'vB'], -1)
    expect(asignaciones.filter((a) => a.vendedorId === 'vA')).toHaveLength(2)
    expect(asignaciones.filter((a) => a.vendedorId === 'vB')).toHaveLength(2)
  })
})
