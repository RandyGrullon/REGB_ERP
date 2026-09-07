/**
 * Flota & Vehiculos — §5.4, modulo 54.
 *
 * La vigencia de licencia/seguro reutiliza `certificadoVigente()` de
 * `training.ts` -la misma pregunta ("esto ya vencio?") que ya se
 * resolvio para certificados de empleados, sin reinventarla-.
 */

import { certificadoVigente } from './training.js'

export { certificadoVigente as documentoVehiculoVigente } from './training.js'

/** Kilometros por litro -guarda contra dividir entre cero-. */
export function eficienciaCombustible(kmRecorridos: number, litros: number): number {
  if (litros <= 0) return 0
  return kmRecorridos / litros
}

/** Si ya toca el proximo mantenimiento, por kilometraje. */
export function mantenimientoVencidoPorKm(
  kmActual: number,
  kmUltimoServicio: number,
  intervaloKm: number,
): boolean {
  return kmActual - kmUltimoServicio >= intervaloKm
}

/**
 * Si ya toca el proximo mantenimiento, por fecha -reutiliza la misma
 * pregunta de vigencia que un documento, invertida: si YA NO esta
 * vigente el plazo, toca mantenimiento-.
 */
export function mantenimientoVencidoPorFecha(fechaLimite: Date, asOf: Date): boolean {
  return !certificadoVigente(fechaLimite, asOf)
}

export type EstadoMulta = 'pending' | 'paid' | 'disputed' | 'dismissed'

const TRANSICIONES_MULTA: Record<EstadoMulta, EstadoMulta[]> = {
  pending: ['paid', 'disputed'],
  disputed: ['paid', 'dismissed'],
  paid: [],
  dismissed: [],
}

/** `pending` se paga o se disputa; una disputa se paga o se descarta; `paid`/`dismissed` son terminales. */
export function transicionValidaMulta(actual: EstadoMulta, siguiente: EstadoMulta): boolean {
  return TRANSICIONES_MULTA[actual].includes(siguiente)
}
