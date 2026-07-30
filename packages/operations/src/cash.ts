import { roundBankers } from '@regb/core'

/**
 * Turnos y arqueo de caja — §5.3, modulo 35.
 *
 * El arqueo compara lo que la caja DEBERIA tener con lo que el cajero contó.
 * Solo cuenta el efectivo: una venta con tarjeta no pone billetes en la
 * gaveta. Por eso los pagos vienen desglosados por metodo y no como un total.
 */

export type PaymentMethod = 'cash' | 'card' | 'transfer'

export interface Payment {
  method: PaymentMethod
  amount: number
}

export interface CashReconciliation {
  /** Lo que debe haber en la gaveta: fondo inicial + ventas en efectivo. */
  expected: number
  /** Lo que el cajero contó. */
  counted: number
  /** counted - expected. Negativo = falta dinero. */
  difference: number
}

/**
 * Cuadre del turno. `payments` son los pagos de las ventas NO anuladas: una
 * venta anulada devuelve el dinero, asi que no puede seguir contando.
 */
export function reconcileCash(
  openingCash: number,
  payments: Payment[],
  countedCash: number,
): CashReconciliation {
  const efectivo = payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0)

  const expected = roundBankers(openingCash + efectivo, 2)
  const counted = roundBankers(countedCash, 2)

  return { expected, counted, difference: roundBankers(counted - expected, 2) }
}

/** Totales por metodo de pago, para el reporte de cierre. */
export function paymentBreakdown(payments: Payment[]): Record<PaymentMethod, number> {
  const acc: Record<PaymentMethod, number> = { cash: 0, card: 0, transfer: 0 }
  for (const p of payments) acc[p.method] += p.amount
  return {
    cash: roundBankers(acc.cash, 2),
    card: roundBankers(acc.card, 2),
    transfer: roundBankers(acc.transfer, 2),
  }
}

/**
 * Un pago mixto tiene que sumar exactamente el total de la venta.
 *
 * La tolerancia de un centavo NO es holgura contable: es la unica forma de
 * que dividir RD$100 entre tres formas de pago no rechace la venta por un
 * residuo de redondeo.
 */
export function paymentsBalance(payments: Payment[], total: number): boolean {
  const suma = payments.reduce((a, p) => a + p.amount, 0)
  return Math.abs(roundBankers(suma - total, 2)) <= 0.01
}

/** Vuelto. Si lo entregado no alcanza, devuelve 0: no existe el vuelto negativo. */
export function computeChange(tendered: number, total: number): number {
  return roundBankers(Math.max(0, tendered - total), 2)
}
