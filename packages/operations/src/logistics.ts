/**
 * Logistica & Rutas — §5.4, modulo 53.
 *
 * Honesto desde el nombre de este archivo: no hay geocodificacion ni
 * mapa real, asi que no existe un algoritmo de OPTIMIZACION de ruta
 * por distancia -eso pediria coordenadas reales y un motor de rutas,
 * que no es parte de este sistema-. El orden de las paradas lo decide
 * quien planifica. Lo que SI es real: la maquina de estados de la
 * ruta y de cada parada, y la tasa de entrega exitosa calculada de
 * las paradas de verdad, no declarada a mano.
 */

export type EstadoRuta = 'planned' | 'in_progress' | 'completed' | 'cancelled'

const TRANSICIONES_RUTA: Record<EstadoRuta, EstadoRuta[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
}

/** `planned` despacha o cancela; `in_progress` solo completa; el resto es terminal. */
export function transicionValidaRuta(actual: EstadoRuta, siguiente: EstadoRuta): boolean {
  return TRANSICIONES_RUTA[actual].includes(siguiente)
}

export type EstadoParada = 'pending' | 'delivered' | 'failed'

/** Una ruta esta completa cuando ninguna parada sigue `pending` -entregada o fallida, pero resuelta-. */
export function rutaCompleta(paradas: { status: EstadoParada }[]): boolean {
  return paradas.length > 0 && paradas.every((p) => p.status !== 'pending')
}

/**
 * Porcentaje de paradas RESUELTAS que terminaron entregadas -las
 * `pending` no cuentan ni para arriba ni para abajo, todavia no se
 * sabe que van a ser-.
 */
export function tasaEntregaExitosa(paradas: { status: EstadoParada }[]): number {
  const resueltas = paradas.filter((p) => p.status !== 'pending')
  if (resueltas.length === 0) return 0
  const entregadas = resueltas.filter((p) => p.status === 'delivered').length
  return entregadas / resueltas.length
}
