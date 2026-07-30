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

/** Fecha ISO (YYYY-MM-DD) sin zona horaria, para columnas `date`. */
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
