import { describe, expect, it } from 'vitest'
import {
  costoNetoUnitario,
  costVariance,
  deriveReceiptStatus,
  pendingReceipt,
  validateReceipt,
} from './procurement'

describe('deriveReceiptStatus', () => {
  it('sin lineas es borrador', () => {
    expect(deriveReceiptStatus([])).toBe('draft')
  })

  it('con lineas y nada recibido es confirmado', () => {
    expect(deriveReceiptStatus([{ qtyOrdered: 10, qtyReceived: 0 }])).toBe('confirmed')
  })

  it('recibido parcial es partially_received', () => {
    expect(deriveReceiptStatus([{ qtyOrdered: 10, qtyReceived: 4 }])).toBe('partially_received')
  })

  it('recibido completo es received', () => {
    expect(deriveReceiptStatus([{ qtyOrdered: 10, qtyReceived: 10 }])).toBe('received')
  })

  it('varias lineas: el total manda, no una linea suelta', () => {
    // Una linea completa y otra a medias: en conjunto sigue parcial.
    const lineas = [
      { qtyOrdered: 10, qtyReceived: 10 },
      { qtyOrdered: 5, qtyReceived: 2 },
    ]
    expect(deriveReceiptStatus(lineas)).toBe('partially_received')
  })

  it('cancelado manda sobre cualquier cosa que digan las lineas', () => {
    expect(deriveReceiptStatus([{ qtyOrdered: 10, qtyReceived: 10 }], true)).toBe('cancelled')
  })
})

describe('pendingReceipt', () => {
  it('resta lo recibido de lo pedido', () => {
    expect(pendingReceipt({ qtyOrdered: 10, qtyReceived: 3 })).toBe(7)
  })

  it('nunca da negativo aunque los datos esten mal', () => {
    expect(pendingReceipt({ qtyOrdered: 5, qtyReceived: 8 })).toBe(0)
  })
})

describe('validateReceipt', () => {
  it('acepta recibir menos de lo pendiente', () => {
    expect(validateReceipt({ qtyOrdered: 10, qtyReceived: 0 }, 4)).toEqual({ ok: true })
  })

  it('acepta recibir exactamente lo pendiente', () => {
    expect(validateReceipt({ qtyOrdered: 10, qtyReceived: 6 }, 4)).toEqual({ ok: true })
  })

  it('rechaza recibir mas de lo pendiente', () => {
    const r = validateReceipt({ qtyOrdered: 10, qtyReceived: 6 }, 5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Solo quedan 4/)
  })

  it('rechaza cantidad cero o negativa', () => {
    expect(validateReceipt({ qtyOrdered: 10, qtyReceived: 0 }, 0).ok).toBe(false)
    expect(validateReceipt({ qtyOrdered: 10, qtyReceived: 0 }, -3).ok).toBe(false)
  })
})

describe('costVariance', () => {
  it('llega mas caro: diferencia y porcentaje positivos', () => {
    const v = costVariance(100, 110)
    expect(v.diferencia).toBe(10)
    expect(v.porcentaje).toBeCloseTo(0.1)
  })

  it('llega mas barato: diferencia y porcentaje negativos', () => {
    const v = costVariance(100, 90)
    expect(v.diferencia).toBe(-10)
    expect(v.porcentaje).toBeCloseTo(-0.1)
  })

  it('llega igual: cero en los dos', () => {
    const v = costVariance(100, 100)
    expect(v.diferencia).toBe(0)
    expect(v.porcentaje).toBe(0)
  })

  it('costo cotizado en cero no revienta con division por cero', () => {
    const v = costVariance(0, 50)
    expect(v.diferencia).toBe(50)
    expect(v.porcentaje).toBe(0)
  })
})

describe('costoNetoUnitario', () => {
  it('sin descuento es el cotizado', () => {
    expect(costoNetoUnitario(420)).toBe(420)
    expect(costoNetoUnitario(420, 0)).toBe(420)
  })

  it('resta el descuento del proveedor: 420 al 5% entra a 399, no a 420', () => {
    expect(costoNetoUnitario(420, 5)).toBe(399)
  })

  it('redondea a 4 decimales, como unit_cost y avg_cost', () => {
    expect(costoNetoUnitario(33.3333, 7.5)).toBe(30.8333)
  })

  it('un descuento fuera de 0-100 no da costos negativos ni mayores', () => {
    expect(costoNetoUnitario(100, 150)).toBe(0)
    expect(costoNetoUnitario(100, -10)).toBe(100)
  })
})
