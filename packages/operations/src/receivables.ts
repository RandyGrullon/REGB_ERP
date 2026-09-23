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

// ── Nota de credito por monto ───────────────────────────────────────────

/**
 * Separa un monto CON ITBIS en base e impuesto, en la misma proporcion
 * que la factura que se rebaja.
 *
 * Una rebaja de RD$1,180 sobre una factura toda gravada al 18% es 1,000
 * de base y 180 de ITBIS: el ITBIS que se reverso tiene que salir en el
 * 607 para que el cliente no se descuente de mas. Sobre una factura
 * exenta, todo es base.
 */
export function splitTaxInclusive(
  amount: number,
  invoiceTax: number,
  invoiceTotal: number,
): { subtotal: number; tax: number } {
  if (invoiceTotal <= 0 || invoiceTax <= 0) return { subtotal: roundBankers(amount, 2), tax: 0 }
  const tax = roundBankers((amount * invoiceTax) / invoiceTotal, 2)
  return { subtotal: roundBankers(amount - tax, 2), tax }
}

// ── Credito: limite y bloqueo por vencidas ──────────────────────────────

/**
 * Dias de atraso a partir de los cuales un cliente ya no recibe credito
 * nuevo, si el negocio no dice otra cosa.
 *
 * Por que 30: el Cliente #1 vende a 15 y 30 dias. Un cliente que pasa un
 * mes entero DESPUES de su vencimiento ya dobló (o triplicó) el plazo que
 * se le dio: no es un despiste de una semana, es un patron. Menos de 30
 * frenaria por un cheque que llega tarde; mas de 60 deja crecer la deuda
 * de alguien que ya dejo de pagar. Es configurable por negocio
 * (`ar_credit_policy`, 0130) porque una ferreteria que fia a contratistas
 * y un distribuidor de electronica no toleran lo mismo.
 */
export const DIAS_BLOQUEO_POR_DEFECTO = 30

export interface CreditInvoice {
  number: string
  /** Saldo pendiente real: capital + mora - cobros - notas de credito. */
  balance: number
  dueDate: Date
}

export interface CreditCheckInput {
  /** null = el negocio no le puso limite a este cliente. */
  creditLimit: number | null
  /** Facturas no anuladas del cliente (las saldadas se ignoran solas). */
  invoices: CreditInvoice[]
  /**
   * Pedidos ya confirmados que todavia no se facturan, SIN contar el
   * documento que se esta evaluando. Es credito comprometido: sin esto,
   * diez pedidos de 40,000 contra un limite de 50,000 pasarian uno a uno.
   */
  uninvoicedOrders: number
  /** El pedido o la factura que se esta intentando emitir. */
  documentTotal: number
  /** null = el negocio no bloquea por vencidas. */
  overdueBlockDays: number | null
  asOf: Date
}

export type CreditBlock =
  | { code: 'limit'; limit: number; exposure: number; documentTotal: number; excess: number }
  | { code: 'overdue'; days: number; maxDays: number; invoices: string[] }

export interface CreditDecision {
  allowed: boolean
  blocks: CreditBlock[]
  /** Saldo pendiente: facturas con saldo + pedidos confirmados sin facturar. */
  exposure: number
  /** Limite menos saldo pendiente. null = sin limite. Puede ser negativo. */
  available: number | null
  /** Dias de la factura con saldo mas atrasada; 0 si ninguna esta vencida. */
  oldestOverdueDays: number
}

/**
 * Si a este cliente se le puede vender a credito este documento.
 *
 * Dos reglas independientes, y se reportan las dos si fallan las dos
 * -quien autoriza una excepcion tiene que saber TODO lo que se esta
 * saltando, no solo lo primero que se encontro-:
 *
 *  1. Limite: saldo pendiente + documento > limite. Igual al limite pasa.
 *  2. Vencidas: alguna factura con saldo lleva MAS de N dias vencida.
 *     El dia N todavia no bloquea (mismo criterio que `agingBucket`: el
 *     dia del vencimiento aun es "por vencer").
 *
 * No decide si hay excepcion: eso es un permiso y una firma, no logica.
 */
export function evaluateCredit(input: CreditCheckInput): CreditDecision {
  const conSaldo = input.invoices.filter((f) => roundBankers(f.balance, 2) > 0)
  const facturado = conSaldo.reduce((a, f) => a + f.balance, 0)
  const exposure = roundBankers(facturado + Math.max(0, input.uninvoicedOrders), 2)
  const blocks: CreditBlock[] = []

  let available: number | null = null
  if (input.creditLimit !== null) {
    available = roundBankers(input.creditLimit - exposure, 2)
    const despues = roundBankers(exposure + input.documentTotal, 2)
    if (despues > input.creditLimit) {
      blocks.push({
        code: 'limit',
        limit: input.creditLimit,
        exposure,
        documentTotal: roundBankers(input.documentTotal, 2),
        excess: roundBankers(despues - input.creditLimit, 2),
      })
    }
  }

  const atrasos = conSaldo
    .map((f) => ({ number: f.number, days: daysOverdue(f.dueDate, input.asOf) }))
    .sort((a, b) => b.days - a.days)
  const oldestOverdueDays = Math.max(0, atrasos[0]?.days ?? 0)

  if (input.overdueBlockDays !== null) {
    const max = input.overdueBlockDays
    const pasadas = atrasos.filter((a) => a.days > max)
    if (pasadas.length > 0) {
      blocks.push({
        code: 'overdue',
        days: pasadas[0]!.days,
        maxDays: max,
        invoices: pasadas.map((p) => p.number),
      })
    }
  }

  return { allowed: blocks.length === 0, blocks, exposure, available, oldestOverdueDays }
}

const rd = (n: number): string =>
  `RD$ ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * El porque del bloqueo, en palabras del mostrador. Lo lee el vendedor
 * con el cliente delante: tiene que decir cuanto, desde cuando y que
 * hacer, no "credito insuficiente".
 */
export function creditBlockMessage(customerName: string, blocks: CreditBlock[]): string {
  const partes: string[] = []
  for (const b of blocks) {
    if (b.code === 'overdue') {
      const lista =
        b.invoices.length <= 3
          ? b.invoices.join(', ')
          : `${b.invoices.slice(0, 3).join(', ')} y ${b.invoices.length - 3} mas`
      partes.push(
        `tiene facturas vencidas hace ${b.days} dias (${lista}) y el maximo que se tolera es ${b.maxDays}`,
      )
    } else {
      partes.push(
        `su saldo pendiente (${rd(b.exposure)}) mas este documento (${rd(b.documentTotal)}) ` +
          `pasa su limite de credito de ${rd(b.limit)} por ${rd(b.excess)}`,
      )
    }
  }
  return (
    `Credito bloqueado para ${customerName}: ${partes.join('; y ')}. ` +
    'Cobra primero, o que alguien con permiso autorice la excepcion escribiendo el motivo.'
  )
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
