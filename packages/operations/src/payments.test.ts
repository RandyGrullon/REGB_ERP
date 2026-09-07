import { describe, expect, it } from 'vitest'
import { dueCharges, isLinkExpired, nextChargeDate } from './payments.js'

const dia = (m: number, d: number) => new Date(2026, m - 1, d)

describe('nextChargeDate', () => {
  it('semanal avanza 7 dias', () => {
    const n = nextChargeDate(dia(9, 1), 'weekly')
    expect(n.getUTCMonth()).toBe(8) // septiembre, 0-indexado
    expect(n.getUTCDate()).toBe(8)
  })

  it('mensual avanza un mes, mismo dia', () => {
    const n = nextChargeDate(dia(9, 15), 'monthly')
    expect(n.getUTCMonth()).toBe(9) // octubre
    expect(n.getUTCDate()).toBe(15)
  })

  it('anual avanza un ano, misma fecha', () => {
    const n = nextChargeDate(dia(9, 15), 'yearly')
    expect(n.getUTCFullYear()).toBe(2027)
    expect(n.getUTCMonth()).toBe(8)
    expect(n.getUTCDate()).toBe(15)
  })
})

describe('dueCharges', () => {
  it('un cobro con fecha de hoy esta vencido', () => {
    const d = dueCharges([{ id: 'c1', nextChargeDate: dia(9, 10), frequency: 'monthly' }], dia(9, 10))
    expect(d).toHaveLength(1)
    expect(d[0]!.id).toBe('c1')
  })

  it('un cobro con fecha futura no esta vencido todavia', () => {
    const d = dueCharges([{ id: 'c1', nextChargeDate: dia(9, 20), frequency: 'monthly' }], dia(9, 10))
    expect(d).toHaveLength(0)
  })

  it('un cobro atrasado varios dias tambien cuenta como vencido', () => {
    const d = dueCharges([{ id: 'c1', nextChargeDate: dia(9, 1), frequency: 'weekly' }], dia(9, 10))
    expect(d).toHaveLength(1)
  })

  it('calcula la siguiente fecha a partir de LA FECHA QUE VENCIO, no de hoy', () => {
    // Vencio el 1, pero la corrida ocurre el 10: la siguiente fecha debe
    // salir de sumarle la frecuencia al 1, no al 10 -para no perder el
    // ritmo original del calendario si una corrida se atrasa-.
    const d = dueCharges([{ id: 'c1', nextChargeDate: dia(9, 1), frequency: 'weekly' }], dia(9, 10))
    expect(d[0]!.nextChargeDate.getUTCDate()).toBe(8)
  })

  it('separa correctamente varios cobros, cada uno con su propio estado', () => {
    const d = dueCharges(
      [
        { id: 'vencido', nextChargeDate: dia(9, 5), frequency: 'monthly' },
        { id: 'futuro', nextChargeDate: dia(10, 5), frequency: 'monthly' },
      ],
      dia(9, 10),
    )
    expect(d.map((x) => x.id)).toEqual(['vencido'])
  })
})

describe('isLinkExpired', () => {
  it('un link pendiente pasada su fecha de expiracion esta vencido', () => {
    expect(isLinkExpired('pending', dia(9, 1), dia(9, 10))).toBe(true)
  })

  it('un link pendiente antes de su fecha de expiracion no esta vencido', () => {
    expect(isLinkExpired('pending', dia(9, 20), dia(9, 10))).toBe(false)
  })

  it('el mismo dia de expiracion todavia no esta vencido', () => {
    expect(isLinkExpired('pending', dia(9, 10), dia(9, 10))).toBe(false)
  })

  it('un link ya pagado nunca se marca vencido, sin importar la fecha', () => {
    expect(isLinkExpired('paid', dia(1, 1), dia(9, 10))).toBe(false)
  })

  it('sin fecha de expiracion, nunca vence', () => {
    expect(isLinkExpired('pending', null, dia(9, 10))).toBe(false)
  })
})
