import { describe, expect, it } from 'vitest'
import {
  agingBucket,
  balanceAfter,
  buildAging,
  daysOverdue,
  deriveInvoiceStatus,
  overpayment,
  type OpenInvoice,
} from './receivables.js'

const CORTE = new Date(2026, 6, 31) // 31 jul 2026
const hace = (dias: number) => new Date(2026, 6, 31 - dias)

describe('dias vencidos', () => {
  it('cuenta los dias desde el vencimiento', () => {
    expect(daysOverdue(hace(45), CORTE)).toBe(45)
  })

  it('el dia del vencimiento son cero dias', () => {
    expect(daysOverdue(CORTE, CORTE)).toBe(0)
  })

  it('lo que aun no vence sale negativo', () => {
    expect(daysOverdue(new Date(2026, 7, 10), CORTE)).toBe(-10)
  })

  it('cruza fin de mes sin equivocarse', () => {
    expect(daysOverdue(new Date(2026, 5, 30), CORTE)).toBe(31)
  })
})

describe('tramos de antiguedad', () => {
  it('el dia del vencimiento todavia es por vencer', () => {
    expect(agingBucket(CORTE, CORTE)).toBe('current')
  })

  it('vence a partir del dia siguiente', () => {
    expect(agingBucket(hace(1), CORTE)).toBe('d1_30')
  })

  it('respeta los limites exactos de cada tramo', () => {
    expect(agingBucket(hace(30), CORTE)).toBe('d1_30')
    expect(agingBucket(hace(31), CORTE)).toBe('d31_60')
    expect(agingBucket(hace(60), CORTE)).toBe('d31_60')
    expect(agingBucket(hace(61), CORTE)).toBe('d61_90')
    expect(agingBucket(hace(90), CORTE)).toBe('d61_90')
    expect(agingBucket(hace(91), CORTE)).toBe('d90_plus')
  })

  it('una factura futura es por vencer', () => {
    expect(agingBucket(new Date(2026, 8, 1), CORTE)).toBe('current')
  })
})

describe('reporte de cartera', () => {
  const facturas: OpenInvoice[] = [
    { customerId: 'c1', customerName: 'Colmado Ramona', dueDate: hace(10), balanceDue: 5000 },
    { customerId: 'c1', customerName: 'Colmado Ramona', dueDate: hace(45), balanceDue: 3000 },
    { customerId: 'c2', customerName: 'Ferreteria El Clavo', dueDate: hace(95), balanceDue: 12000 },
    {
      customerId: 'c3',
      customerName: 'Super Nuevo',
      dueDate: new Date(2026, 7, 15),
      balanceDue: 2000,
    },
  ]

  it('reparte por tramo', () => {
    const r = buildAging(facturas, CORTE)
    expect(r.byBucket.current).toBe(2000)
    expect(r.byBucket.d1_30).toBe(5000)
    expect(r.byBucket.d31_60).toBe(3000)
    expect(r.byBucket.d90_plus).toBe(12000)
  })

  it('separa el total de lo vencido: lo por vencer no es mora', () => {
    const r = buildAging(facturas, CORTE)
    expect(r.total).toBe(22000)
    expect(r.overdue).toBe(20000)
  })

  it('agrupa por cliente y ordena por saldo, el que mas debe primero', () => {
    const r = buildAging(facturas, CORTE)
    expect(r.byCustomer[0]!.customerName).toBe('Ferreteria El Clavo')
    expect(r.byCustomer[0]!.total).toBe(12000)
    const ramona = r.byCustomer.find((c) => c.customerId === 'c1')!
    expect(ramona.total).toBe(8000)
    expect(ramona.buckets.d1_30).toBe(5000)
  })

  it('ignora facturas ya saldadas', () => {
    const r = buildAging(
      [
        ...facturas,
        { customerId: 'c9', customerName: 'Pagada', dueDate: hace(200), balanceDue: 0 },
      ],
      CORTE,
    )
    expect(r.byCustomer.some((c) => c.customerId === 'c9')).toBe(false)
    expect(r.total).toBe(22000)
  })

  it('la misma cartera a otra fecha de corte cae en otros tramos', () => {
    // 30 dias antes, la de 45 dias solo tenia 15.
    const antes = buildAging(facturas, new Date(2026, 6, 1))
    expect(antes.byBucket.d1_30).toBe(3000)
    expect(antes.byBucket.d61_90).toBe(12000)
  })

  it('sin facturas devuelve ceros, no se rompe', () => {
    const r = buildAging([], CORTE)
    expect(r.total).toBe(0)
    expect(r.byCustomer).toEqual([])
  })
})

describe('estado de la factura', () => {
  const futura = new Date(2026, 7, 30)

  it('sin cobros y sin vencer esta abierta', () => {
    expect(deriveInvoiceStatus(1000, 0, futura, CORTE)).toBe('open')
  })

  it('con un cobro parcial y sin vencer, parcialmente pagada', () => {
    expect(deriveInvoiceStatus(1000, 400, futura, CORTE)).toBe('partially_paid')
  })

  it('saldada por completo esta pagada', () => {
    expect(deriveInvoiceStatus(1000, 1000, futura, CORTE)).toBe('paid')
  })

  it('vencida con saldo pendiente es vencida, aunque tenga abonos', () => {
    expect(deriveInvoiceStatus(1000, 400, hace(5), CORTE)).toBe('overdue')
  })

  it('pagada gana sobre vencida: cobrar tarde sigue siendo cobrar', () => {
    expect(deriveInvoiceStatus(1000, 1000, hace(50), CORTE)).toBe('paid')
  })
})

describe('saldos', () => {
  it('descuenta cobros y notas de credito', () => {
    expect(balanceAfter(10000, [3000, 1500])).toBe(5500)
  })

  it('un sobrepago deja saldo en cero, no negativo', () => {
    expect(balanceAfter(1000, [1200])).toBe(0)
  })

  it('el excedente se reporta aparte para volverlo credito del cliente', () => {
    expect(overpayment(1000, [1200])).toBe(200)
    expect(overpayment(1000, [800])).toBe(0)
  })
})
