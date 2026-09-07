import { yearsOfService } from './employees.js'

/**
 * Vacaciones & Permisos -Sec5.6, modulo 64 (F7/S39).
 *
 * El saldo de vacaciones NUNCA se guarda: se deriva siempre de la fecha
 * de contratacion (Codigo de Trabajo Art. 177) menos lo ya aprobado.
 * Solo se implementa el derecho general de vacaciones -el resto de los
 * tipos de ausencia (enfermedad, maternidad, etc.) se registran y se
 * aprueban, pero este sistema no calcula un saldo legal para ellos: eso
 * pide certificacion medica y reglas que no se pueden verificar aqui.
 */

const DIA_MS = 86_400_000

/** Dias laborables entre dos fechas -inclusive-, sin contar sabado ni domingo. */
export function diasLaborablesEntre(inicio: Date, fin: Date): number {
  const desde = Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate())
  const hasta = Date.UTC(fin.getFullYear(), fin.getMonth(), fin.getDate())
  if (hasta < desde) return 0

  let dias = 0
  for (let t = desde; t <= hasta; t += DIA_MS) {
    const diaSemana = new Date(t).getUTCDay()
    if (diaSemana !== 0 && diaSemana !== 6) dias += 1
  }
  return dias
}

/**
 * Dias de vacaciones que otorga UN año completo de servicio -Codigo de
 * Trabajo Art. 177-: 14 dias laborables por año durante los primeros
 * cuatro, 18 dias laborables por año a partir del quinto.
 */
export function diasVacacionesPorAnioDeServicio(anio: number): number {
  if (anio < 1) return 0
  return anio >= 5 ? 18 : 14
}

/** Total acumulado desde la contratacion hasta una fecha de corte -sumando cada año completo-. */
export function vacacionesAcumuladas(fechaContratacion: Date, fechaCorte: Date): number {
  const anios = yearsOfService(fechaContratacion, fechaCorte)
  let total = 0
  for (let anio = 1; anio <= anios; anio++) {
    total += diasVacacionesPorAnioDeServicio(anio)
  }
  return total
}

/** Saldo disponible: lo acumulado menos lo ya tomado -nunca negativo-. */
export function saldoVacaciones(
  fechaContratacion: Date,
  fechaCorte: Date,
  diasYaTomados: number,
): number {
  return Math.max(0, vacacionesAcumuladas(fechaContratacion, fechaCorte) - diasYaTomados)
}
