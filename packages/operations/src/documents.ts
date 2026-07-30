import { roundBankers } from '@regb/core'

/**
 * Totales de un documento comercial — pedido, ticket de POS o factura.
 *
 * Los tres calculan igual, asi que el calculo vive una sola vez. La puerta F5
 * exige que un `grep` de una formula de dinero de UNA ocurrencia.
 *
 * El ITBIS se calcula POR LINEA y se suma, no sobre el subtotal general: con
 * productos a tasas distintas (un colmado vende arroz exento y refrescos
 * gravados en el mismo ticket) el total general daria mal.
 */

export interface DocumentLineInput {
  quantity: number
  unitPrice: number
  /** Porcentaje 0-100 sobre la linea. */
  discountPct?: number
  /** Tasa en fraccion: 0.18 para ITBIS. 0 para exento. */
  taxRate?: number
}

export interface DocumentLineTotals {
  gross: number
  discount: number
  subtotal: number
  tax: number
  total: number
}

export interface DocumentTotals {
  subtotal: number
  discount: number
  tax: number
  total: number
  lines: DocumentLineTotals[]
}

export function lineTotals(line: DocumentLineInput): DocumentLineTotals {
  if (line.quantity <= 0) {
    throw new Error(`La cantidad debe ser positiva; se recibio ${line.quantity}`)
  }
  if (line.unitPrice < 0) {
    throw new Error(`El precio no puede ser negativo; se recibio ${line.unitPrice}`)
  }
  const pct = line.discountPct ?? 0
  if (pct < 0 || pct > 100) {
    throw new Error(`El descuento va de 0 a 100; se recibio ${pct}`)
  }

  const gross = line.quantity * line.unitPrice
  const discount = gross * (pct / 100)
  const subtotal = gross - discount
  const tax = subtotal * (line.taxRate ?? 0)

  return {
    gross: roundBankers(gross, 2),
    discount: roundBankers(discount, 2),
    subtotal: roundBankers(subtotal, 2),
    tax: roundBankers(tax, 2),
    total: roundBankers(subtotal + tax, 2),
  }
}

/**
 * Totales del documento. Se acumula en crudo y se redondea al final, no linea
 * por linea: redondear en cada paso desvia el total en documentos largos.
 */
export function documentTotals(lines: DocumentLineInput[]): DocumentTotals {
  let subtotal = 0
  let discount = 0
  let tax = 0

  const detalle: DocumentLineTotals[] = []
  for (const l of lines) {
    const t = lineTotals(l)
    detalle.push(t)
    const pct = l.discountPct ?? 0
    const gross = l.quantity * l.unitPrice
    const desc = gross * (pct / 100)
    const sub = gross - desc
    discount += desc
    subtotal += sub
    tax += sub * (l.taxRate ?? 0)
  }

  return {
    subtotal: roundBankers(subtotal, 2),
    discount: roundBankers(discount, 2),
    tax: roundBankers(tax, 2),
    total: roundBankers(subtotal + tax, 2),
    lines: detalle,
  }
}

/**
 * Fecha de vencimiento segun los dias de credito del cliente. Cero dias =
 * contado, vence el mismo dia.
 */
export function dueDateFrom(issueDate: Date, paymentTermsDays: number): Date {
  const d = new Date(issueDate)
  d.setDate(d.getDate() + Math.max(0, paymentTermsDays))
  return d
}

/**
 * Un descuento por encima del limite del rol necesita aprobacion. Se
 * comprueba en el servidor, nunca solo en el boton: el Cajero trae
 * `pos.discount.max` en el alcance de su rol (§8).
 */
export function discountWithinLimit(discountPct: number, maxPct: number | null): boolean {
  if (maxPct === null) return true
  return discountPct <= maxPct
}
