import { describe, expect, it } from 'vitest'
import { validateEntryLines } from './accounting.js'
import {
  PROPOSITOS_CONTABLES,
  asientoCargoMora,
  asientoCobroCliente,
  asientoFacturaCredito,
  asientoNotaCredito,
  asientoFacturaProveedor,
  asientoPagoProveedor,
  asientoVentaContado,
  invertirAsiento,
  propositoDelGasto,
  propositoDelMetodo,
  type LineaAutomatica,
} from './asientos.js'

/** Suma por proposito: debito positivo, credito negativo. */
function neto(lineas: LineaAutomatica[]): Record<string, number> {
  const r: Record<string, number> = {}
  for (const l of lineas) {
    const k = l.purpose ?? l.accountId!
    r[k] = Math.round(((r[k] ?? 0) + l.debit - l.credit) * 100) / 100
  }
  return r
}

describe('propositos del mapa contable', () => {
  it('no se repite ningun proposito y cada uno trae codigo y tipo', () => {
    const ids = PROPOSITOS_CONTABLES.map((p) => p.proposito)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PROPOSITOS_CONTABLES) {
      expect(p.codigo).toMatch(/^\d{4}$/)
      expect(['asset', 'liability', 'equity', 'revenue', 'expense']).toContain(p.tipo)
    }
  })

  it('dos propositos que comparten codigo por defecto piden el mismo tipo de cuenta', () => {
    // compras -> 1104 igual que inventario: si los tipos no coincidieran,
    // el segundo nunca se podria mapear a la cuenta que crea el primero.
    const porCodigo = new Map<string, string>()
    for (const p of PROPOSITOS_CONTABLES) {
      const ya = porCodigo.get(p.codigo)
      if (ya) expect(ya).toBe(p.tipo)
      porCodigo.set(p.codigo, p.tipo)
    }
  })

  it('efectivo va a caja y todo lo demas al banco', () => {
    expect(propositoDelMetodo('cash')).toBe('caja')
    expect(propositoDelMetodo('card')).toBe('banco')
    expect(propositoDelMetodo('transfer')).toBe('banco')
    expect(propositoDelMetodo('check')).toBe('banco')
  })

  it('606 tipo 09 o sin clasificar es compra de mercancia; lo demas, gasto', () => {
    expect(propositoDelGasto(null)).toBe('compras')
    expect(propositoDelGasto('09')).toBe('compras')
    expect(propositoDelGasto('02')).toBe('gastos')
    expect(propositoDelGasto('11')).toBe('gastos')
  })
})

describe('venta de contado', () => {
  it('efectivo: caja contra ventas e ITBIS, y costo contra inventario', () => {
    const l = asientoVentaContado({
      total: '236.00',
      impuesto: '36.00',
      pagos: [{ method: 'cash', amount: '236.00' }],
      costo: 120,
    })
    expect(validateEntryLines(l)).toEqual({ ok: true })
    expect(neto(l)).toEqual({
      caja: 236,
      ventas: -200,
      itbis_por_pagar: -36,
      costo_ventas: 120,
      inventario: -120,
    })
  })

  it('pago mixto: cada forma de pago va a su cuenta', () => {
    const l = asientoVentaContado({
      total: 1180,
      impuesto: 180,
      pagos: [
        { method: 'cash', amount: 500 },
        { method: 'card', amount: 400 },
        { method: 'transfer', amount: 280 },
      ],
    })
    expect(neto(l)).toEqual({ caja: 500, banco: 680, ventas: -1000, itbis_por_pagar: -180 })
  })

  it('el centavo de redondeo entre formas de pago no descuadra el asiento', () => {
    // 100 / 3 = 33.33 x 3 = 99.99: la caja lo acepta (tolerancia de un
    // centavo) y el asiento tiene que cuadrar con el total igual.
    const l = asientoVentaContado({
      total: 100,
      impuesto: 0,
      pagos: [
        { method: 'cash', amount: 33.33 },
        { method: 'card', amount: 33.33 },
        { method: 'card', amount: 33.33 },
      ],
    })
    expect(validateEntryLines(l)).toEqual({ ok: true })
    expect(neto(l)).toEqual({ caja: 33.33, banco: 66.67, ventas: -100 })
  })

  it('producto exento y sin costo: solo caja contra ventas, sin lineas en cero', () => {
    const l = asientoVentaContado({ total: 50, impuesto: 0, pagos: [{ method: 'cash', amount: 50 }] })
    expect(l).toHaveLength(2)
    expect(l.every((x) => x.debit > 0 || x.credit > 0)).toBe(true)
  })

  it('aritmetica en centavos: 0.1 + 0.2 no deja un residuo', () => {
    const l = asientoVentaContado({
      total: 0.3,
      impuesto: 0.05,
      pagos: [
        { method: 'cash', amount: 0.1 },
        { method: 'cash', amount: 0.2 },
      ],
    })
    expect(neto(l)).toEqual({ caja: 0.3, ventas: -0.25, itbis_por_pagar: -0.05 })
  })
})

describe('credito: factura y cobro', () => {
  it('la factura debita la cartera por el total', () => {
    const l = asientoFacturaCredito({ total: '11800.00', impuesto: '1800.00' })
    expect(neto(l)).toEqual({ cxc: 11800, ventas: -10000, itbis_por_pagar: -1800 })
  })

  it('una factura en cero no genera lineas', () => {
    expect(asientoFacturaCredito({ total: 0, impuesto: 0 })).toEqual([])
  })

  it('el cobro con transferencia va al banco contra la cartera', () => {
    const l = asientoCobroCliente({ monto: '5000.00', metodo: 'transfer' })
    expect(neto(l)).toEqual({ banco: 5000, cxc: -5000 })
  })

  it('la nota de credito es la factura al reves por su monto', () => {
    const l = asientoNotaCredito({ total: 118, impuesto: 18 })
    expect(neto(l)).toEqual({ ventas: 100, itbis_por_pagar: 18, cxc: -118 })
  })

  it('la mora aumenta la cartera contra un ingreso aparte, sin ITBIS', () => {
    const l = asientoCargoMora({ monto: 500 })
    expect(neto(l)).toEqual({ cxc: 500, ingresos_mora: -500 })
  })
})

describe('proveedor: factura y pago', () => {
  it('mercancia con ITBIS: inventario e ITBIS adelantado contra la cuenta por pagar', () => {
    const l = asientoFacturaProveedor({ total: 11800, impuesto: 1800 })
    expect(neto(l)).toEqual({ compras: 10000, itbis_adelantado: 1800, cxp: -11800 })
  })

  it('honorarios con retencion: lo retenido se le debe a la DGII, no al proveedor', () => {
    // 10,000 + 1,800 ITBIS; se retiene el 100% del ITBIS (1,800) y 10% de
    // ISR (1,000): al proveedor se le deben 9,000.
    const l = asientoFacturaProveedor({
      total: 11800,
      impuesto: 1800,
      retencion: 2800,
      isrRetenido: 1000,
      tipoGasto: '02',
    })
    expect(validateEntryLines(l)).toEqual({ ok: true })
    expect(neto(l)).toEqual({
      gastos: 10000,
      itbis_adelantado: 1800,
      cxp: -9000,
      itbis_retenido: -1800,
      isr_retenido: -1000,
    })
  })

  it('el pago en efectivo sale de la caja', () => {
    const l = asientoPagoProveedor({ monto: 9000, metodo: 'cash' })
    expect(neto(l)).toEqual({ cxp: 9000, caja: -9000 })
  })
})

describe('reverso', () => {
  it('intercambia debito y credito sobre las mismas cuentas y suma cero con el original', () => {
    const original = [
      { accountId: 'a-caja', debit: '236.00', credit: '0' },
      { accountId: 'a-ventas', debit: '0', credit: '200.00' },
      { accountId: 'a-itbis', debit: '0', credit: '36.00', memo: 'ITBIS 18%' },
    ]
    const r = invertirAsiento(original)
    expect(r).toEqual([
      { accountId: 'a-caja', debit: 0, credit: 236 },
      { accountId: 'a-ventas', debit: 200, credit: 0 },
      { accountId: 'a-itbis', debit: 36, credit: 0, memo: 'ITBIS 18%' },
    ])
    const juntos = neto([
      ...original.map((o) => ({ accountId: o.accountId, debit: Number(o.debit), credit: Number(o.credit) })),
      ...r,
    ])
    expect(Object.values(juntos).every((v) => v === 0)).toBe(true)
  })
})
