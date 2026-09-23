import { describe, expect, it } from 'vitest'
import {
  DIAS_BLOQUEO_POR_DEFECTO,
  creditBlockMessage,
  evaluateCredit,
  splitTaxInclusive,
  type CreditCheckInput,
} from './receivables.js'
import { chooseInvoiceNcf } from './dgii.js'
import { generar607 } from './dgii-envio.js'
import { deriveOrderStatus } from './fulfillment.js'
import { listaAplicable, resolverPrecio, type ListaPrecio } from './price-lists.js'

/**
 * Venta a credito (0130): limite, bloqueo por vencidas, B01/B02 sin
 * adivinar, estado del pedido confirmado sin existencia y lista de
 * precios asignada al cliente.
 */

const HOY = new Date(2026, 8, 23) // 23 sep 2026
const haceDias = (n: number) => new Date(2026, 8, 23 - n)

const base = (o: Partial<CreditCheckInput> = {}): CreditCheckInput => ({
  creditLimit: null,
  invoices: [],
  uninvoicedOrders: 0,
  documentTotal: 0,
  overdueBlockDays: DIAS_BLOQUEO_POR_DEFECTO,
  asOf: HOY,
  ...o,
})

describe('evaluateCredit — vencidas', () => {
  it('el valor por defecto es 30 dias', () => {
    expect(DIAS_BLOQUEO_POR_DEFECTO).toBe(30)
  })

  it('una factura vencida hace 96 dias bloquea, y dice cual y cuantos dias', () => {
    const d = evaluateCredit(
      base({
        invoices: [{ number: 'FAC-DEMO-0003', balance: 12064, dueDate: haceDias(96) }],
        documentTotal: 100000,
      }),
    )
    expect(d.allowed).toBe(false)
    expect(d.oldestOverdueDays).toBe(96)
    expect(d.blocks).toEqual([
      { code: 'overdue', days: 96, maxDays: 30, invoices: ['FAC-DEMO-0003'] },
    ])
  })

  it('el dia 30 exacto todavia no bloquea; el 31 si', () => {
    const f = (dias: number) =>
      evaluateCredit(base({ invoices: [{ number: 'F', balance: 1, dueDate: haceDias(dias) }] }))
    expect(f(30).allowed).toBe(true)
    expect(f(31).allowed).toBe(false)
  })

  it('una factura vencida pero ya saldada no cuenta', () => {
    const d = evaluateCredit(
      base({ invoices: [{ number: 'F', balance: 0, dueDate: haceDias(200) }] }),
    )
    expect(d.allowed).toBe(true)
    expect(d.oldestOverdueDays).toBe(0)
  })

  it('con la politica en null no se bloquea por vencidas', () => {
    const d = evaluateCredit(
      base({
        overdueBlockDays: null,
        invoices: [{ number: 'F', balance: 500, dueDate: haceDias(400) }],
      }),
    )
    expect(d.allowed).toBe(true)
    expect(d.oldestOverdueDays).toBe(400)
  })

  it('lista las vencidas de la mas vieja a la mas nueva', () => {
    const d = evaluateCredit(
      base({
        invoices: [
          { number: 'B', balance: 1, dueDate: haceDias(40) },
          { number: 'A', balance: 1, dueDate: haceDias(90) },
          { number: 'C', balance: 1, dueDate: haceDias(10) },
        ],
      }),
    )
    expect(d.blocks[0]).toMatchObject({ code: 'overdue', days: 90, invoices: ['A', 'B'] })
  })
})

describe('evaluateCredit — limite', () => {
  it('saldo + documento por encima del limite bloquea, con el exceso exacto', () => {
    const d = evaluateCredit(
      base({
        creditLimit: 50000,
        invoices: [{ number: 'F', balance: 40000, dueDate: haceDias(-10) }],
        documentTotal: 11800,
      }),
    )
    expect(d.allowed).toBe(false)
    expect(d.exposure).toBe(40000)
    expect(d.available).toBe(10000)
    expect(d.blocks).toEqual([
      { code: 'limit', limit: 50000, exposure: 40000, documentTotal: 11800, excess: 1800 },
    ])
  })

  it('igual al limite pasa', () => {
    const d = evaluateCredit(
      base({
        creditLimit: 50000,
        invoices: [{ number: 'F', balance: 38200, dueDate: haceDias(-10) }],
        documentTotal: 11800,
      }),
    )
    expect(d.allowed).toBe(true)
  })

  it('los pedidos confirmados sin facturar cuentan como saldo', () => {
    const d = evaluateCredit(base({ creditLimit: 20000, uninvoicedOrders: 11800, documentTotal: 11800 }))
    expect(d.exposure).toBe(11800)
    expect(d.allowed).toBe(false)
  })

  it('sin limite no hay bloqueo por monto, por grande que sea', () => {
    expect(evaluateCredit(base({ uninvoicedOrders: 9e6, documentTotal: 9e6 })).allowed).toBe(true)
  })

  it('limite 0 = no se le fia nada', () => {
    expect(evaluateCredit(base({ creditLimit: 0, documentTotal: 1 })).allowed).toBe(false)
  })

  it('si fallan las dos reglas se reportan las dos', () => {
    const d = evaluateCredit(
      base({
        creditLimit: 1000,
        invoices: [{ number: 'F', balance: 5000, dueDate: haceDias(96) }],
        documentTotal: 100,
      }),
    )
    expect(d.blocks.map((b) => b.code)).toEqual(['limit', 'overdue'])
  })
})

describe('splitTaxInclusive — nota de credito por monto', () => {
  it('1,180 sobre una factura toda al 18% es 1,000 + 180', () => {
    expect(splitTaxInclusive(1180, 1800, 11800)).toEqual({ subtotal: 1000, tax: 180 })
  })
  it('sobre una factura exenta todo es base', () => {
    expect(splitTaxInclusive(500, 0, 5000)).toEqual({ subtotal: 500, tax: 0 })
  })
  it('la base mas el impuesto dan el monto al centavo', () => {
    const r = splitTaxInclusive(333.33, 1764.76, 11564)
    expect(Math.round((r.subtotal + r.tax) * 100) / 100).toBe(333.33)
  })
})

describe('generar607 — la nota de credito lleva el NCF que modifica', () => {
  it('campo 4 = NCF de la factura en la B04; vacio en la factura', () => {
    const txt = generar607('401007551', '202503', [
      {
        rncComprador: null,
        tipoIdentificacion: '3',
        ncf: 'B0200000001',
        fechaComprobante: '20250310',
        montoFacturado: 5000,
        itbisFacturado: 900,
        credito: 5900,
      },
      {
        rncComprador: null,
        tipoIdentificacion: '3',
        ncf: 'B0400000001',
        ncfModificado: 'B0200000001',
        fechaComprobante: '20250320',
        montoFacturado: 2000,
        itbisFacturado: 360,
        credito: 2360,
      },
    ])
    const [, factura, nota] = txt.trim().split(/\r?\n/)
    expect(factura!.split('|')[3]).toBe('')
    expect(nota!.split('|')[2]).toBe('B0400000001')
    expect(nota!.split('|')[3]).toBe('B0200000001')
  })
})

describe('creditBlockMessage', () => {
  it('dice cuanto, desde cuando y que hacer', () => {
    const msg = creditBlockMessage('Ferreteria El Martillo SRL', [
      { code: 'overdue', days: 96, maxDays: 30, invoices: ['FAC-DEMO-0003'] },
      { code: 'limit', limit: 50000, exposure: 40000, documentTotal: 11800, excess: 1800 },
    ])
    expect(msg).toMatch(/Ferreteria El Martillo SRL/)
    expect(msg).toMatch(/96 dias \(FAC-DEMO-0003\)/)
    expect(msg).toMatch(/maximo que se tolera es 30/)
    expect(msg).toMatch(/RD\$ 40,000\.00/)
    expect(msg).toMatch(/limite de credito de RD\$ 50,000\.00 por RD\$ 1,800\.00/)
    expect(msg).toMatch(/autorice la excepcion/)
  })

  it('con muchas facturas no las lista todas', () => {
    const msg = creditBlockMessage('X', [
      { code: 'overdue', days: 60, maxDays: 30, invoices: ['A', 'B', 'C', 'D', 'E'] },
    ])
    expect(msg).toMatch(/A, B, C y 2 mas/)
  })
})

describe('chooseInvoiceNcf — nunca B02 en silencio', () => {
  it('sin RNC y sin pedir nada: consumo', () => {
    expect(chooseInvoiceNcf('auto', null)).toEqual({ ok: true, tipo: 'B02', buyerTaxId: null })
    expect(chooseInvoiceNcf('auto', '   ')).toEqual({ ok: true, tipo: 'B02', buyerTaxId: null })
  })

  it('RNC valido: credito fiscal, en digitos', () => {
    expect(chooseInvoiceNcf('auto', '401-00755-1')).toEqual({
      ok: true,
      tipo: 'B01',
      buyerTaxId: '401007551',
    })
  })

  it('RNC invalido sin pedir nada: error que lo dice, no B02', () => {
    const d = chooseInvoiceNcf('auto', '131223345')
    expect(d.ok).toBe(false)
    if (d.ok) return
    expect(d.code).toBe('invalid-tax-id')
    expect(d.error).toMatch(/131-22334-5/)
    expect(d.error).toMatch(/B02/)
  })

  it('B01 pedido sin RNC: error', () => {
    const d = chooseInvoiceNcf('B01', null)
    expect(d).toMatchObject({ ok: false, code: 'missing-tax-id' })
  })

  it('B01 pedido con RNC invalido: error', () => {
    expect(chooseInvoiceNcf('B01', '131223345')).toMatchObject({ ok: false, code: 'invalid-tax-id' })
  })

  it('B02 pedido a proposito: consumo; el RNC invalido no viaja, el valido si', () => {
    expect(chooseInvoiceNcf('B02', '131223345')).toEqual({ ok: true, tipo: 'B02', buyerTaxId: null })
    expect(chooseInvoiceNcf('B02', '401007551')).toEqual({
      ok: true,
      tipo: 'B02',
      buyerTaxId: '401007551',
    })
  })

  it('una cedula valida tambien da B01', () => {
    // Sintetica: Luhn sobre 0010000000 da suma 1 -> verificador 9.
    expect(chooseInvoiceNcf('auto', '001-0000000-9')).toEqual({
      ok: true,
      tipo: 'B01',
      buyerTaxId: '00100000009',
    })
    expect(chooseInvoiceNcf('auto', '001-0000000-1')).toMatchObject({ ok: false })
  })
})

describe('deriveOrderStatus — confirmar sin existencia', () => {
  const sinNada = [{ qtyOrdered: 10, qtyReserved: 0, qtyDelivered: 0 }]

  it('sin decir que se confirmo, sigue siendo borrador', () => {
    expect(deriveOrderStatus(sinNada)).toBe('draft')
  })

  it('confirmado con TODO en backorder es confirmado, no borrador', () => {
    expect(deriveOrderStatus(sinNada, false, true)).toBe('confirmed')
  })

  it('confirmado no pisa lo entregado', () => {
    expect(deriveOrderStatus([{ qtyOrdered: 10, qtyReserved: 0, qtyDelivered: 4 }], false, true)).toBe(
      'partially_delivered',
    )
  })
})

describe('listaAplicable — la lista asignada al cliente', () => {
  const lista = (id: string, scope: ListaPrecio['scope'], o: Partial<ListaPrecio> = {}): ListaPrecio => ({
    id,
    scope,
    customerId: null,
    channel: null,
    startDate: new Date(2026, 0, 1),
    endDate: null,
    status: 'active',
    ...o,
  })

  it('la asignada gana a la general, aunque sea de alcance general', () => {
    const listas = [lista('general', 'general'), lista('mayorista', 'general', { startDate: new Date(2025, 0, 1) })]
    // Sin asignar: la general mas reciente.
    expect(listaAplicable(listas, { customerId: 'c1', channel: null }, HOY)!.id).toBe('general')
    // Asignada: la del cliente, aunque sea mas vieja.
    expect(
      listaAplicable(listas, { customerId: 'c1', channel: null, assignedListId: 'mayorista' }, HOY)!.id,
    ).toBe('mayorista')
  })

  it('la asignada gana tambien a una lista por cliente', () => {
    const listas = [lista('propia', 'customer', { customerId: 'c1' }), lista('asignada', 'channel', { channel: 'x' })]
    expect(
      listaAplicable(listas, { customerId: 'c1', channel: null, assignedListId: 'asignada' }, HOY)!.id,
    ).toBe('asignada')
  })

  it('una asignada vencida o inactiva no aplica: se resuelve como antes', () => {
    const listas = [lista('general', 'general'), lista('vieja', 'general', { status: 'inactive' })]
    expect(
      listaAplicable(listas, { customerId: 'c1', channel: null, assignedListId: 'vieja' }, HOY)!.id,
    ).toBe('general')
  })

  it('resolverPrecio cobra el precio de la asignada', () => {
    const listas = [lista('general', 'general'), lista('mayorista', 'general', { startDate: new Date(2025, 0, 1) })]
    const entradas = [
      { priceListId: 'general', minQuantity: 1, unitPrice: 95 },
      { priceListId: 'mayorista', minQuantity: 1, unitPrice: 80 },
    ]
    expect(
      resolverPrecio(100, listas, entradas, { customerId: 'c1', channel: null, cantidad: 1 }, HOY).precio,
    ).toBe(95)
    expect(
      resolverPrecio(
        100,
        listas,
        entradas,
        { customerId: 'c1', channel: null, cantidad: 1, assignedListId: 'mayorista' },
        HOY,
      ),
    ).toEqual({ precio: 80, listaId: 'mayorista' })
  })
})
