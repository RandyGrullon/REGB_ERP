import { describe, expect, it } from 'vitest'
import {
  discountWithinLimit,
  documentTotals,
  dueDateFrom,
  lineTotals,
  type DocumentLineInput,
} from './documents.js'

describe('totales de linea', () => {
  it('calcula una linea gravada con ITBIS', () => {
    const t = lineTotals({ quantity: 2, unitPrice: 100, taxRate: 0.18 })
    expect(t).toEqual({ gross: 200, discount: 0, subtotal: 200, tax: 36, total: 236 })
  })

  it('aplica el descuento antes del impuesto', () => {
    // 1000 - 10% = 900; ITBIS sobre 900 = 162
    const t = lineTotals({ quantity: 10, unitPrice: 100, discountPct: 10, taxRate: 0.18 })
    expect(t.discount).toBe(100)
    expect(t.subtotal).toBe(900)
    expect(t.tax).toBe(162)
    expect(t.total).toBe(1062)
  })

  it('un producto exento no paga impuesto', () => {
    const t = lineTotals({ quantity: 5, unitPrice: 85, taxRate: 0 })
    expect(t.tax).toBe(0)
    expect(t.total).toBe(425)
  })

  it('sin tasa declarada asume exento, no 18%', () => {
    expect(lineTotals({ quantity: 1, unitPrice: 100 }).tax).toBe(0)
  })

  it('acepta cantidades fraccionarias, que las hay al vender por libra', () => {
    const t = lineTotals({ quantity: 2.5, unitPrice: 40, taxRate: 0.18 })
    expect(t.subtotal).toBe(100)
    expect(t.tax).toBe(18)
  })

  it('rechaza cantidades, precios y descuentos invalidos', () => {
    expect(() => lineTotals({ quantity: 0, unitPrice: 10 })).toThrow(/cantidad/)
    expect(() => lineTotals({ quantity: 1, unitPrice: -5 })).toThrow(/negativo/)
    expect(() => lineTotals({ quantity: 1, unitPrice: 10, discountPct: 120 })).toThrow(/0 a 100/)
  })
})

describe('totales del documento', () => {
  it('suma varias lineas', () => {
    const lineas: DocumentLineInput[] = [
      { quantity: 2, unitPrice: 100, taxRate: 0.18 },
      { quantity: 1, unitPrice: 50, taxRate: 0.18 },
    ]
    const t = documentTotals(lineas)
    expect(t.subtotal).toBe(250)
    expect(t.tax).toBe(45)
    expect(t.total).toBe(295)
  })

  it('mezcla exentos y gravados calculando el impuesto POR LINEA', () => {
    // Un colmado: arroz exento + refresco gravado en el mismo ticket.
    const t = documentTotals([
      { quantity: 1, unitPrice: 215, taxRate: 0 },
      { quantity: 2, unitPrice: 60, taxRate: 0.18 },
    ])
    expect(t.subtotal).toBe(335)
    expect(t.tax).toBe(21.6) // solo sobre los 120 del refresco
    expect(t.total).toBe(356.6)
  })

  it('acumula en crudo: redondear linea a linea desviaria el total', () => {
    // Tres lineas de 0.335 de impuesto: redondeadas darian 1.02; el real es 1.005 -> 1.00
    const t = documentTotals([
      { quantity: 1, unitPrice: 1.8611, taxRate: 0.18 },
      { quantity: 1, unitPrice: 1.8611, taxRate: 0.18 },
      { quantity: 1, unitPrice: 1.8611, taxRate: 0.18 },
    ])
    expect(t.tax).toBe(1)
  })

  it('un documento vacio da todo en cero', () => {
    const t = documentTotals([])
    expect(t).toMatchObject({ subtotal: 0, discount: 0, tax: 0, total: 0 })
  })

  it('devuelve tambien el detalle por linea, para imprimirlo', () => {
    const t = documentTotals([{ quantity: 2, unitPrice: 100, taxRate: 0.18 }])
    expect(t.lines).toHaveLength(1)
    expect(t.lines[0]!.total).toBe(236)
  })
})

describe('vencimiento', () => {
  it('suma los dias de credito', () => {
    const d = dueDateFrom(new Date(2026, 6, 1), 30)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(31)
  })

  it('contado vence el mismo dia', () => {
    const emision = new Date(2026, 6, 15)
    expect(dueDateFrom(emision, 0).getTime()).toBe(emision.getTime())
  })

  it('cruza de mes correctamente', () => {
    const d = dueDateFrom(new Date(2026, 6, 20), 30)
    expect(d.getMonth()).toBe(7) // agosto
    expect(d.getDate()).toBe(19)
  })
})

describe('limite de descuento', () => {
  it('permite hasta el limite inclusive', () => {
    expect(discountWithinLimit(10, 10)).toBe(true)
    expect(discountWithinLimit(5, 10)).toBe(true)
  })

  it('rechaza por encima del limite', () => {
    expect(discountWithinLimit(15, 10)).toBe(false)
  })

  it('sin limite configurado no restringe', () => {
    expect(discountWithinLimit(50, null)).toBe(true)
  })
})
