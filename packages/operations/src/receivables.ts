import { roundBankers } from '@regb/core'

/**
 * Cartera y antiguedad de saldos — §5.2, modulo 17.
 *
 * La antiguedad se calcula sobre el SALDO PENDIENTE, no sobre el total de la
 * factura: una factura de $10,000 con $9,000 ya cobrados envejece $1,000, no
 * $10,000. Confundirlo infla la cartera vencida y hace perseguir a quien ya
 * pago casi todo.
 */

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: 'Por vencer',
  d1_30: '1 a 30 dias',
  d31_60: '31 a 60 dias',
  d61_90: '61 a 90 dias',
  d90_plus: 'Mas de 90 dias',
}

/** Dias transcurridos desde el vencimiento. Negativo = aun no vence. */
export function daysOverdue(dueDate: Date, asOf: Date): number {
  const MS_DIA = 86_400_000
  const venc = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
  const corte = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
  return Math.floor((corte - venc) / MS_DIA)
}

/**
 * Tramo de antiguedad. El dia del vencimiento todavia es "por vencer": se
 * cuenta vencida a partir del dia siguiente, que es como lo lee un cliente.
 */
export function agingBucket(dueDate: Date, asOf: Date): AgingBucket {
  const d = daysOverdue(dueDate, asOf)
  if (d <= 0) return 'current'
  if (d <= 30) return 'd1_30'
  if (d <= 60) return 'd31_60'
  if (d <= 90) return 'd61_90'
  return 'd90_plus'
}

export interface OpenInvoice {
  customerId: string
  customerName: string
  dueDate: Date
  /** Lo que falta por cobrar, ya descontados cobros y notas de credito. */
  balanceDue: number
}

export interface AgingReport {
  byBucket: Record<AgingBucket, number>
  byCustomer: {
    customerId: string
    customerName: string
    buckets: Record<AgingBucket, number>
    total: number
  }[]
  total: number
  overdue: number
}

const bucketsVacios = (): Record<AgingBucket, number> => ({
  current: 0,
  d1_30: 0,
  d31_60: 0,
  d61_90: 0,
  d90_plus: 0,
})

/**
 * Reparte la cartera abierta por tramo y por cliente.
 *
 * `asOf` es parametro y no `new Date()` interno a proposito: el contador
 * necesita la cartera "al 31 de diciembre", no la de hoy.
 */
export function buildAging(invoices: OpenInvoice[], asOf: Date): AgingReport {
  const byBucket = bucketsVacios()
  const porCliente = new Map<string, { name: string; buckets: Record<AgingBucket, number> }>()

  for (const inv of invoices) {
    if (inv.balanceDue <= 0) continue // saldada: no es cartera
    const bucket = agingBucket(inv.dueDate, asOf)
    byBucket[bucket] += inv.balanceDue

    const actual = porCliente.get(inv.customerId) ?? {
      name: inv.customerName,
      buckets: bucketsVacios(),
    }
    actual.buckets[bucket] += inv.balanceDue
    porCliente.set(inv.customerId, actual)
  }

  const redondear = (b: Record<AgingBucket, number>): Record<AgingBucket, number> => ({
    current: roundBankers(b.current, 2),
    d1_30: roundBankers(b.d1_30, 2),
    d31_60: roundBankers(b.d31_60, 2),
    d61_90: roundBankers(b.d61_90, 2),
    d90_plus: roundBankers(b.d90_plus, 2),
  })

  const byCustomer = [...porCliente.entries()]
    .map(([customerId, v]) => {
      const buckets = redondear(v.buckets)
      const total = roundBankers(
        Object.values(v.buckets).reduce((a, n) => a + n, 0),
        2,
      )
      return { customerId, customerName: v.name, buckets, total }
    })
    .sort((a, b) => b.total - a.total)

  const bruto = Object.values(byBucket)
  return {
    byBucket: redondear(byBucket),
    byCustomer,
    total: roundBankers(
      bruto.reduce((a, n) => a + n, 0),
      2,
    ),
    overdue: roundBankers(
      byBucket.d1_30 + byBucket.d31_60 + byBucket.d61_90 + byBucket.d90_plus,
      2,
    ),
  }
}

export type InvoiceStatus = 'open' | 'partially_paid' | 'paid' | 'overdue' | 'void'

/**
 * Estado de una factura a partir de su saldo. `void` no se deriva: anular es
 * una decision humana.
 *
 * Un sobrepago deja la factura en `paid` con saldo cero; el excedente lo
 * gestiona quien llama (nota de credito a favor), no se pierde aqui.
 */
export function deriveInvoiceStatus(
  total: number,
  settled: number,
  dueDate: Date,
  asOf: Date,
): InvoiceStatus {
  const saldo = roundBankers(total - settled, 2)
  if (saldo <= 0) return 'paid'
  if (daysOverdue(dueDate, asOf) > 0) return 'overdue'
  if (settled > 0) return 'partially_paid'
  return 'open'
}

/** Saldo tras aplicar cobros y notas de credito. Nunca negativo. */
export function balanceAfter(total: number, settlements: number[]): number {
  const aplicado = settlements.reduce((a, n) => a + n, 0)
  return roundBankers(Math.max(0, total - aplicado), 2)
}

/** Excedente de un sobrepago, para convertirlo en credito del cliente. */
export function overpayment(total: number, settlements: number[]): number {
  const aplicado = settlements.reduce((a, n) => a + n, 0)
  return roundBankers(Math.max(0, aplicado - total), 2)
}

/**
 * Si se le puede aplicar un cargo por mora a esta factura.
 *
 * NO hay formula que calcule el monto: eso lo decide el negocio caso por
 * caso y puede cambiar. Esta funcion solo decide si la opcion se OFRECE —
 * cliente exento o factura anulada, nunca; sin dias de atraso, tampoco
 * tiene sentido (no hay mora que cobrar).
 */
export function lateFeeEligible(
  invoiceStatus: InvoiceStatus,
  customerExempt: boolean,
  daysLate: number,
): boolean {
  if (customerExempt) return false
  if (invoiceStatus === 'void') return false
  return daysLate > 0
}
