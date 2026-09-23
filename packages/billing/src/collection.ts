/**
 * Calendario de cobro — regla 8 del agente regb-billing:
 * todo cobro fallido reintenta dia 1, 3, 7 y 14 antes de escalar a dunning.
 *
 * Logica pura de fechas; el estado vive en regb.payment_attempts.
 */

/** Dias despues del vencimiento en que se intenta cobrar. El 0 es el cobro inicial. */
export const CHARGE_SCHEDULE_DAYS = [0, 1, 3, 7, 14] as const

export const MAX_CHARGE_ATTEMPTS = CHARGE_SCHEDULE_DAYS.length

/**
 * Fecha del intento N (1-indexado) contando desde el vencimiento.
 * Devuelve null cuando ya no quedan reintentos: toca dunning (S17).
 */
export function chargeAttemptDate(dueDate: Date, attemptNo: number): Date | null {
  const offset = CHARGE_SCHEDULE_DAYS[attemptNo - 1]
  if (offset === undefined) return null
  const d = new Date(dueDate)
  d.setDate(d.getDate() + offset)
  return d
}

/**
 * Clave de idempotencia del intento: determinista por factura e intento,
 * de modo que REINTENTAR el mismo intento manda la misma clave y la
 * pasarela deduplica en su lado (regla 7).
 */
export function chargeIdempotencyKey(invoiceNumber: string, attemptNo: number): string {
  return `${invoiceNumber}:attempt-${attemptNo}`
}

/** Periodo mensual [primer dia, ultimo dia] del mes de `anchor`. */
export function monthlyPeriod(anchor: Date): { start: Date; end: Date } {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  return { start, end }
}

/**
 * Dias que tiene el cliente para pagar desde que la factura existe.
 *
 * Antes la factura vencia el PRIMER dia de su periodo: generada el 23 de
 * septiembre, nacia con 22 dias de mora y el primer dunning mandaba al
 * cliente directo a solo lectura, sin haber visto un solo recordatorio.
 */
export const PAYMENT_TERM_DAYS = 15

/**
 * Vencimiento: `PAYMENT_TERM_DAYS` despues del inicio del periodo o de la
 * emision, lo que sea MAS TARDE. Una factura del mes corriente emitida a
 * mitad de mes no nace vencida; una emitida por adelantado vence 15 dias
 * dentro de su propio periodo.
 */
export function invoiceDueDate(periodStart: Date, issuedAt: Date): Date {
  const inicio = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate())
  const emision = new Date(issuedAt.getFullYear(), issuedAt.getMonth(), issuedAt.getDate())
  const base = emision > inicio ? emision : inicio
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + PAYMENT_TERM_DAYS)
}

/** Fecha ISO (YYYY-MM-DD) sin zona horaria, para columnas `date`. */
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
