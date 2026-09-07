/**
 * Lotes, series y vencimientos — §5.4, modulo 49.
 *
 * FEFO real (first-expired-first-out): un algoritmo que elige de que
 * lote sacar cada unidad, no una tabla plana que alguien revisa a
 * mano. La vigencia de un lote reutiliza `certificadoVigente()` de
 * `training.ts` -la misma pregunta ("esto ya vencio?") que ya se
 * resolvio para certificados de empleados, sin reinventarla-.
 */

export { certificadoVigente as loteVigente } from './training.js'
import { certificadoVigente } from './training.js'

export interface LoteDisponible {
  lotId: string
  expiryDate: Date | null
  qtyAvailable: number
}

export interface AsignacionFefo {
  lotId: string
  qty: number
}

/**
 * Elige de que lotes sacar `qtyNecesaria` unidades, siempre del que
 * vence mas pronto primero -los lotes sin vencimiento van al final,
 * porque un lote CON fecha siempre es mas urgente que uno sin ella-.
 * Si el total disponible no alcanza, devuelve lo que si se pudo
 * asignar (nunca inventa unidades que no existen).
 */
export function seleccionFefo(
  lotes: LoteDisponible[],
  qtyNecesaria: number,
): AsignacionFefo[] {
  const ordenados = [...lotes].sort((a, b) => {
    if (a.expiryDate === null && b.expiryDate === null) return 0
    if (a.expiryDate === null) return 1
    if (b.expiryDate === null) return -1
    return a.expiryDate.getTime() - b.expiryDate.getTime()
  })

  const asignaciones: AsignacionFefo[] = []
  let restante = qtyNecesaria
  for (const lote of ordenados) {
    if (restante <= 0) break
    if (lote.qtyAvailable <= 0) continue
    const tomar = Math.min(lote.qtyAvailable, restante)
    asignaciones.push({ lotId: lote.lotId, qty: tomar })
    restante -= tomar
  }
  return asignaciones
}

/** Si el total disponible entre todos los lotes alcanza para la cantidad pedida. */
export function alcanzaFefo(lotes: LoteDisponible[], qtyNecesaria: number): boolean {
  const total = lotes.reduce((acc, l) => acc + Math.max(0, l.qtyAvailable), 0)
  return total >= qtyNecesaria
}

/**
 * Un lote esta "por vencer" si todavia esta vigente pero le quedan
 * `diasAviso` dias o menos -nunca clasifica un lote YA vencido como
 * "por vencer": esos son dos alertas distintas, no la misma-.
 */
export function loteProximoAVencer(
  expiryDate: Date | null,
  asOf: Date,
  diasAviso = 30,
): boolean {
  if (expiryDate === null) return false
  if (!certificadoVigente(expiryDate, asOf)) return false
  const diasRestantes = (expiryDate.getTime() - asOf.getTime()) / 86_400_000
  return diasRestantes <= diasAviso
}
