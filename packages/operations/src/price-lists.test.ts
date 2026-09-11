import { describe, expect, it } from 'vitest'
import {
  listaAplicable,
  listaVigente,
  precioPorVolumen,
  resolverPrecio,
  type ListaPrecio,
} from './price-lists.js'

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

describe('resolverPrecio — el precio que de verdad se cobra', () => {
  const hoy = new Date('2026-09-10T12:00:00Z')
  const general: ListaPrecio = {
    id: 'gen',
    scope: 'general',
    customerId: null,
    channel: null,
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: null,
    status: 'active',
  }
  const mayorista: ListaPrecio = {
    ...general,
    id: 'may',
    scope: 'customer',
    customerId: 'cli-1',
  }

  it('sin listas cobra el catalogo -asi se enciende sin romper nada-', () => {
    expect(resolverPrecio(100, [], [], { customerId: 'cli-1', channel: null, cantidad: 1 }, hoy)).toEqual({
      precio: 100,
      listaId: null,
    })
  })

  it('la lista del cliente le gana a la general', () => {
    const r = resolverPrecio(
      100,
      [general, mayorista],
      [
        { priceListId: 'gen', minQuantity: 1, unitPrice: 95 },
        { priceListId: 'may', minQuantity: 1, unitPrice: 80 },
      ],
      { customerId: 'cli-1', channel: null, cantidad: 1 },
      hoy,
    )
    expect(r).toEqual({ precio: 80, listaId: 'may' })
  })

  it('a mas cantidad, la cuota de mayoreo', () => {
    const entradas = [
      { priceListId: 'may', minQuantity: 1, unitPrice: 80 },
      { priceListId: 'may', minQuantity: 50, unitPrice: 65 },
    ]
    const ctx = { customerId: 'cli-1', channel: null, cantidad: 50 }
    expect(resolverPrecio(100, [mayorista], entradas, ctx, hoy).precio).toBe(65)
    expect(resolverPrecio(100, [mayorista], entradas, { ...ctx, cantidad: 49 }, hoy).precio).toBe(80)
  })

  it('una lista que no cubre ESE producto cae al catalogo, no deja la linea sin precio', () => {
    const r = resolverPrecio(
      100,
      [mayorista],
      [{ priceListId: 'may', minQuantity: 1, unitPrice: 80 }].filter(() => false),
      { customerId: 'cli-1', channel: null, cantidad: 1 },
      hoy,
    )
    expect(r).toEqual({ precio: 100, listaId: null })
  })

  it('una cantidad por debajo de la cuota minima cae al catalogo', () => {
    const r = resolverPrecio(
      100,
      [mayorista],
      [{ priceListId: 'may', minQuantity: 12, unitPrice: 80 }],
      { customerId: 'cli-1', channel: null, cantidad: 3 },
      hoy,
    )
    expect(r).toEqual({ precio: 100, listaId: null })
  })

  it('una lista vencida no cobra: se cae al catalogo', () => {
    const vencida = { ...mayorista, endDate: new Date('2026-06-30T00:00:00Z') }
    const r = resolverPrecio(
      100,
      [vencida],
      [{ priceListId: 'may', minQuantity: 1, unitPrice: 80 }],
      { customerId: 'cli-1', channel: null, cantidad: 1 },
      hoy,
    )
    expect(r).toEqual({ precio: 100, listaId: null })
  })

  it('un cliente sin lista propia usa la general', () => {
    const r = resolverPrecio(
      100,
      [general, mayorista],
      [
        { priceListId: 'gen', minQuantity: 1, unitPrice: 95 },
        { priceListId: 'may', minQuantity: 1, unitPrice: 80 },
      ],
      { customerId: 'cli-otro', channel: null, cantidad: 1 },
      hoy,
    )
    expect(r).toEqual({ precio: 95, listaId: 'gen' })
  })

  it('una venta de mostrador sin cliente usa la general', () => {
    const r = resolverPrecio(
      100,
      [general, mayorista],
      [{ priceListId: 'gen', minQuantity: 1, unitPrice: 95 }],
      { customerId: null, channel: null, cantidad: 1 },
      hoy,
    )
    expect(r).toEqual({ precio: 95, listaId: 'gen' })
  })
})
