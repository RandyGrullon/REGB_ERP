import { describe, expect, it } from 'vitest'
import { listaAplicable, listaVigente, precioPorVolumen, type ListaPrecio } from './price-lists.js'

const lista = (over: Partial<ListaPrecio>): ListaPrecio => ({
  id: 'x',
  scope: 'general',
  customerId: null,
  channel: null,
  startDate: new Date(2026, 0, 1),
  endDate: null,
  status: 'active',
  ...over,
})

describe('listaVigente', () => {
  it('inactiva nunca esta vigente, sin importar la fecha', () => {
    expect(listaVigente(lista({ status: 'inactive' }), new Date(2026, 5, 1))).toBe(false)
  })

  it('antes de empezar, no esta vigente', () => {
    expect(listaVigente(lista({ startDate: new Date(2026, 5, 1) }), new Date(2026, 0, 1))).toBe(false)
  })

  it('sin fecha de fin, sigue vigente indefinidamente', () => {
    expect(listaVigente(lista({}), new Date(2099, 0, 1))).toBe(true)
  })

  it('despues de vencer, ya no esta vigente', () => {
    expect(listaVigente(lista({ endDate: new Date(2026, 0, 31) }), new Date(2026, 1, 1))).toBe(false)
  })
})

describe('listaAplicable', () => {
  const hoy = new Date(2026, 5, 1)

  it('una lista de cliente vence a una de canal y a la general', () => {
    const listas = [
      lista({ id: 'general', scope: 'general' }),
      lista({ id: 'canal', scope: 'channel', channel: 'wholesale' }),
      lista({ id: 'cliente', scope: 'customer', customerId: 'c1' }),
    ]
    const r = listaAplicable(listas, { customerId: 'c1', channel: 'wholesale' }, hoy)
    expect(r?.id).toBe('cliente')
  })

  it('sin lista de cliente, la de canal gana sobre la general', () => {
    const listas = [
      lista({ id: 'general', scope: 'general' }),
      lista({ id: 'canal', scope: 'channel', channel: 'wholesale' }),
    ]
    const r = listaAplicable(listas, { customerId: 'c1', channel: 'wholesale' }, hoy)
    expect(r?.id).toBe('canal')
  })

  it('sin ninguna especifica, la general se usa como respaldo', () => {
    const listas = [lista({ id: 'general', scope: 'general' })]
    const r = listaAplicable(listas, { customerId: 'c1', channel: 'wholesale' }, hoy)
    expect(r?.id).toBe('general')
  })

  it('sin ninguna lista vigente, no hay ninguna aplicable', () => {
    const listas = [lista({ id: 'vencida', endDate: new Date(2020, 0, 1) })]
    expect(listaAplicable(listas, { customerId: null, channel: null }, hoy)).toBeNull()
  })

  it('entre dos listas del mismo alcance, la de inicio mas reciente gana', () => {
    const listas = [
      lista({ id: 'vieja', scope: 'general', startDate: new Date(2026, 0, 1) }),
      lista({ id: 'nueva', scope: 'general', startDate: new Date(2026, 3, 1) }),
    ]
    const r = listaAplicable(listas, { customerId: null, channel: null }, hoy)
    expect(r?.id).toBe('nueva')
  })
})

describe('precioPorVolumen', () => {
  const cuotas = [
    { minQuantity: 1, unitPrice: 100 },
    { minQuantity: 10, unitPrice: 90 },
    { minQuantity: 50, unitPrice: 80 },
  ]

  it('con poca cantidad, usa la cuota base', () => {
    expect(precioPorVolumen(cuotas, 5)).toBe(100)
  })

  it('al llegar a una cuota, usa el precio de esa cuota', () => {
    expect(precioPorVolumen(cuotas, 10)).toBe(90)
  })

  it('con mas que la cuota mas alta, usa el precio de esa cuota', () => {
    expect(precioPorVolumen(cuotas, 1000)).toBe(80)
  })

  it('sin ninguna cuota que alcance, no hay precio', () => {
    expect(precioPorVolumen(cuotas, 0.5)).toBeNull()
  })
})
