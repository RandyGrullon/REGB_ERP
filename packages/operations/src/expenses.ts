import { roundBankers } from '@regb/core'
import { isValidNcf } from './dgii.js'

/**
 * Gastos & Reembolsos -Sec5.6, modulo 68 (F7/S40).
 *
 * SIN OCR real -leer un recibo fotografiado pide un servicio de vision
 * por computadora con credenciales que este sistema no tiene-. El
 * "recibo" se registra como una nota de texto, no como una foto
 * procesada automaticamente: el monto, la fecha y el proveedor los
 * escribe quien reporta el gasto.
 *
 * "Reembolso en nomina" se registra como un hecho -que periodo lo pago,
 * por que metodo-, no como una linea que se inyecta en el calculo de
 * `payroll_lines`: esa integracion real es una fase futura.
 */

/** ITBIS incluido en un monto bruto -asumiendo que el monto YA lo incluye-. */
export function itbisIncluidoEn(montoBruto: number, tasa = 0.18): number {
  return roundBankers(montoBruto - montoBruto / (1 + tasa), 2)
}

/**
 * Si un gasto es deducible de ITBIS para la empresa: solo con un NCF
 * fiscal valido del proveedor -sin NCF, el reembolso al empleado se
 * paga igual, pero la empresa no puede acreditarse el ITBIS-.
 */
export function esDeducibleDeItbis(ncf: string | null): boolean {
  return ncf !== null && isValidNcf(ncf)
}

/** Total aprobado y todavia sin reembolsar -nunca guardado, se deriva de los gastos-. */
export function totalPendienteDeReembolso(
  gastos: { status: string; amount: number }[],
): number {
  return roundBankers(
    gastos.filter((g) => g.status === 'approved').reduce((acc, g) => acc + g.amount, 0),
    2,
  )
}

/** Desglose por categoria de los gastos no rechazados -para el reporte de gastos-. */
export function totalPorCategoria(
  gastos: { status: string; category: string; amount: number }[],
): Record<string, number> {
  const totales: Record<string, number> = {}
  for (const g of gastos.filter((g) => g.status !== 'rejected')) {
    totales[g.category] = roundBankers((totales[g.category] ?? 0) + g.amount, 2)
  }
  return totales
}

/**
 * Reglas del reembolso -null si se puede; si no, el mensaje-. Por nomina
 * EXIGE un periodo: hasta 0138 se podia marcar "reembolsado por nomina"
 * sin periodo, el gasto quedaba como pagado y ninguna nomina lo pagaba
 * nunca. Por transferencia o efectivo no lleva periodo.
 */
export function validarReembolso(metodo: string, periodoId: string | null): string | null {
  if (!['payroll', 'transfer', 'cash'].includes(metodo)) { // registry:allow — metodos de reembolso
    return 'Elige un método de reembolso válido.'
  }
  if (metodo === 'payroll' && !periodoId) { // registry:allow — metodo de reembolso
    return 'Para reembolsar por nómina, elige la nómina en borrador que lo va a pagar.'
  }
  return null
}
