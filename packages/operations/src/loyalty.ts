export { certificadoVigente as cuponVigente } from './training.js'

/** Puntos que gana una compra: 1 punto por cada RD$100, redondeado hacia abajo. */
export function puntosGanados(total: number, montoPorPunto = 100): number {
  if (total <= 0) return 0
  return Math.floor(total / montoPorPunto)
}

export type NivelFidelidad = 'bronce' | 'plata' | 'oro'

const UMBRAL_PLATA = 500
const UMBRAL_ORO = 1500

/** El nivel se decide por puntos de por vida GANADOS, no por el saldo actual -redimir premios no debe bajar de nivel a nadie-. */
export function nivelPorPuntosDeVida(puntosDeVida: number): NivelFidelidad {
  if (puntosDeVida >= UMBRAL_ORO) return 'oro'
  if (puntosDeVida >= UMBRAL_PLATA) return 'plata'
  return 'bronce'
}

export type EstadoReferido = 'pending' | 'completed' | 'expired'

const TRANSICIONES_REFERIDO: Record<EstadoReferido, EstadoReferido[]> = {
  pending: ['completed', 'expired'],
  completed: [],
  expired: [],
}

export function transicionValidaReferido(actual: EstadoReferido, siguiente: EstadoReferido): boolean {
  return TRANSICIONES_REFERIDO[actual].includes(siguiente)
}

export type EstadoCupon = 'active' | 'redeemed' | 'expired'

const TRANSICIONES_CUPON: Record<EstadoCupon, EstadoCupon[]> = {
  active: ['redeemed', 'expired'],
  redeemed: [],
  expired: [],
}

export function transicionValidaCupon(actual: EstadoCupon, siguiente: EstadoCupon): boolean {
  return TRANSICIONES_CUPON[actual].includes(siguiente)
}

export type TipoDescuentoCupon = 'percentage' | 'fixed'

/** El descuento real de un cupon sobre un subtotal, nunca mayor que el propio subtotal. */
export function descuentoCupon(subtotal: number, tipo: TipoDescuentoCupon, valor: number): number {
  const bruto = tipo === 'percentage' ? subtotal * valor : valor
  return Math.max(0, Math.min(bruto, subtotal))
}
