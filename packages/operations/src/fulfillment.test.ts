import { describe, expect, it } from 'vitest'
import {
  deriveOrderStatus,
  hasBackorder,
  pendingDelivery,
  planFulfillment,
  validateDelivery,
  type OrderLineState,
} from './fulfillment.js'

const linea = (qtyOrdered: number, qtyReserved = 0, qtyDelivered = 0): OrderLineState => ({
  qtyOrdered,
  qtyReserved,
  qtyDelivered,
})

describe('plan de reserva', () => {
  it('con existencia de sobra reserva todo', () => {
    expect(planFulfillment(10, 50)).toEqual({ toReserve: 10, backordered: 0 })
  })

  it('con existencia justa reserva todo y no debe nada', () => {
    expect(planFulfillment(10, 10)).toEqual({ toReserve: 10, backordered: 0 })
  })

  it('reserva parcial: aparta lo que hay y deja el resto en backorder', () => {
    expect(planFulfillment(10, 8)).toEqual({ toReserve: 8, backordered: 2 })
  })

  it('sin existencia queda todo en backorder', () => {
    expect(planFulfillment(10, 0)).toEqual({ toReserve: 0, backordered: 10 })
  })

  it('una disponibilidad negativa se trata como cero, no como deuda al reves', () => {
    expect(planFulfillment(10, -5)).toEqual({ toReserve: 0, backordered: 10 })
  })

  it('rechaza pedir cero o menos', () => {
    expect(() => planFulfillment(0, 10)).toThrow(/positiva/)
  })
})

describe('estado derivado del pedido', () => {
  it('sin lineas es borrador', () => {
    expect(deriveOrderStatus([])).toBe('draft')
  })

  it('con lineas sin reservar ni entregar sigue en borrador', () => {
    expect(deriveOrderStatus([linea(10)])).toBe('draft')
  })

  it('con algo reservado esta confirmado', () => {
    expect(deriveOrderStatus([linea(10, 10)])).toBe('confirmed')
  })

  it('con entrega parcial lo dice', () => {
    expect(deriveOrderStatus([linea(10, 4, 6)])).toBe('partially_delivered')
  })

  it('entregado todo lo pedido cierra el pedido', () => {
    expect(deriveOrderStatus([linea(10, 0, 10)])).toBe('delivered')
  })

  it('mira el total de TODAS las lineas, no una sola', () => {
    // Una linea completa y otra a medias = parcial, no entregado.
    expect(deriveOrderStatus([linea(5, 0, 5), linea(5, 2, 3)])).toBe('partially_delivered')
    expect(deriveOrderStatus([linea(5, 0, 5), linea(5, 0, 5)])).toBe('delivered')
  })

  it('cancelado gana sobre cualquier otro estado', () => {
    expect(deriveOrderStatus([linea(10, 0, 10)], true)).toBe('cancelled')
  })
})

describe('backorder', () => {
  it('hay backorder cuando lo apartado mas lo entregado no cubre lo pedido', () => {
    expect(hasBackorder([linea(10, 8)])).toBe(true)
  })

  it('no hay backorder si entre reservado y entregado se cubre todo', () => {
    expect(hasBackorder([linea(10, 4, 6)])).toBe(false)
    expect(hasBackorder([linea(10, 10)])).toBe(false)
  })

  it('basta una linea corta para marcar el pedido', () => {
    expect(hasBackorder([linea(5, 5), linea(5, 1)])).toBe(true)
  })
})

describe('entregas', () => {
  it('calcula lo pendiente sin dar negativos', () => {
    expect(pendingDelivery(linea(10, 0, 3))).toBe(7)
    expect(pendingDelivery(linea(10, 0, 12))).toBe(0)
  })

  it('acepta una entrega dentro de lo pendiente', () => {
    expect(validateDelivery(linea(10, 10, 3), 7)).toEqual({ ok: true })
  })

  it('rechaza entregar mas de lo pendiente y dice cuanto queda', () => {
    const r = validateDelivery(linea(10, 10, 8), 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Solo quedan 2')
  })

  it('rechaza entregar cero', () => {
    expect(validateDelivery(linea(10), 0).ok).toBe(false)
  })
})
