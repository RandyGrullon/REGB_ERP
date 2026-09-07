/**
 * Pasarelas de cobro — §5, modulo 27 (F6/S34).
 *
 * SIN integracion real a Stripe/Azul/CardNet/PayPal: eso pide credenciales
 * de comercio reales y un review de seguridad que este primer corte no
 * tiene -jamas se construye un formulario que capture datos de tarjeta
 * sin esa base-. Lo que si resuelve: generar el link de cobro, llevar su
 * estado, y avanzar el cobro recurrente a su proximo periodo.
 */

export type ChargeFrequency = 'weekly' | 'monthly' | 'yearly'

/**
 * Proxima fecha de cobro segun la frecuencia. `from` es la fecha del cobro
 * que se acaba de generar, no "hoy" -para que una corrida atrasada no
 * pierda el ritmo del calendario original-.
 */
export function nextChargeDate(from: Date, frequency: ChargeFrequency): Date {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))
  if (frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7)
  } else if (frequency === 'monthly') {
    d.setUTCMonth(d.getUTCMonth() + 1)
  } else {
    d.setUTCFullYear(d.getUTCFullYear() + 1)
  }
  return d
}

export interface RecurringChargeInput {
  id: string
  nextChargeDate: Date
  frequency: ChargeFrequency
}

export interface DueCharge {
  id: string
  chargeDate: Date
  nextChargeDate: Date
}

/**
 * De una lista de cobros recurrentes, cuales ya vencieron -su
 * `nextChargeDate` es hoy o antes- y cual seria su siguiente fecha tras
 * generarse. No genera nada por si sola: solo decide QUE le toca a quien,
 * dejando el efecto (crear el link, avanzar la fecha) a quien la llama.
 */
export function dueCharges(charges: RecurringChargeInput[], asOf: Date): DueCharge[] {
  const limite = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
  return charges
    .filter((c) => Date.UTC(c.nextChargeDate.getFullYear(), c.nextChargeDate.getMonth(), c.nextChargeDate.getDate()) <= limite)
    .map((c) => ({
      id: c.id,
      chargeDate: c.nextChargeDate,
      nextChargeDate: nextChargeDate(c.nextChargeDate, c.frequency),
    }))
}

/** Si un link de cobro ya vencio -paso su fecha de expiracion sin pagarse-. */
export function isLinkExpired(status: string, expiresAt: Date | null, asOf: Date): boolean {
  if (status !== 'pending' || !expiresAt) return false
  const limite = Date.UTC(expiresAt.getFullYear(), expiresAt.getMonth(), expiresAt.getDate())
  const corte = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
  return corte > limite
}
