import { roundBankers } from '@regb/core'

/**
 * Beneficios -Sec5.6, modulo 69 (F7/S41).
 *
 * SIN integracion real con aseguradoras -procesar un reclamo ante una
 * ARS/seguro pide una integracion con esa aseguradora que este sistema
 * no tiene-. Lo que si se resuelve de verdad es la aritmetica de
 * prestamos internos y adelantos de salario: cuota, saldo -siempre
 * derivado de los pagos, nunca guardado- y si ya esta saldado.
 */

/**
 * Cuota de un prestamo interno -sistema frances-. Con tasa 0 (el caso
 * tipico de un prestamo interno sin interes) es una simple division.
 */
export function cuotaPrestamo(principal: number, cuotas: number, tasaMensual = 0): number {
  if (cuotas <= 0) throw new Error(`Las cuotas deben ser un entero positivo; se recibio ${cuotas}`)
  if (tasaMensual === 0) return roundBankers(principal / cuotas, 2)
  const factor = tasaMensual / (1 - (1 + tasaMensual) ** -cuotas)
  return roundBankers(principal * factor, 2)
}

/** Saldo pendiente: el principal menos lo ya pagado -nunca negativo, nunca guardado-. */
export function saldoPrestamo(principal: number, pagos: { amount: number }[]): number {
  const pagado = pagos.reduce((acc, p) => acc + p.amount, 0)
  return Math.max(0, roundBankers(principal - pagado, 2))
}

/** Si un prestamo ya quedo completamente saldado. */
export function estaSaldado(principal: number, pagos: { amount: number }[]): boolean {
  return saldoPrestamo(principal, pagos) === 0
}

/** Aporte patronal total de las inscripciones activas -para el costo de beneficios del mes-. */
export function totalAportePatronal(
  inscripciones: { status: string; employer_contribution: number }[],
): number {
  return roundBankers(
    inscripciones
      .filter((i) => i.status === 'active')
      .reduce((acc, i) => acc + i.employer_contribution, 0),
    2,
  )
}

/**
 * Lo que el empleado debe pagar en total por un prestamo. Sin interes, el
 * principal. Con interes (sistema frances), todas las cuotas: la cuota ya
 * lleva el interes, y comparar los pagos contra el principal -como se
 * hacia hasta 0138- daba el prestamo por saldado antes de cobrar el
 * interes pactado.
 */
export function totalAPagarPrestamo(
  principal: number,
  cuotas: number,
  cuota: number,
  tasaMensual = 0,
): number {
  if (tasaMensual === 0) return roundBankers(principal, 2)
  return roundBankers(cuota * cuotas, 2)
}

/**
 * Si un pago cabe en lo que queda del prestamo -null si cabe; si no, el
 * mensaje-. Un pago de mas dejaba el saldo en 0 y el excedente perdido.
 */
export function validarPagoPrestamo(saldo: number, monto: number): string | null {
  if (!(monto > 0)) return 'El monto debe ser mayor que cero.'
  if (roundBankers(monto, 2) > roundBankers(saldo, 2)) {
    return `El pago (${monto.toFixed(2)}) es mayor que lo que queda por pagar (${saldo.toFixed(2)}).`
  }
  return null
}
