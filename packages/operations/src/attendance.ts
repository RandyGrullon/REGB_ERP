import { roundBankers } from '@regb/core'

/**
 * Asistencia & Ponches — §5.6, modulo 63 (F7/S39).
 *
 * SIN biometrico real -una huella digital pide hardware que este sistema
 * no controla-. Geocerca SI se resuelve de verdad: la formula de
 * haversine sobre latitud/longitud, comparada contra un radio permitido
 * alrededor de la sucursal.
 */

const RADIO_TIERRA_METROS = 6_371_000

/** Distancia entre dos puntos GPS, en metros -formula de haversine-. */
export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return RADIO_TIERRA_METROS * c
}

/** Si un punto GPS cae dentro del radio permitido alrededor de un centro. */
export function isWithinGeofence(
  pointLat: number,
  pointLng: number,
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
): boolean {
  return haversineDistanceMeters(pointLat, pointLng, centerLat, centerLng) <= radiusMeters
}

/** Horas trabajadas entre entrada y salida, en decimal -7.5, no 7:30-. */
export function workedHours(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime()
  return roundBankers(Math.max(0, ms) / 3_600_000, 2)
}

/** Horas extra: lo que pasa de la jornada estandar -8 horas por defecto-. */
export function overtimeHours(worked: number, standardHours = 8): number {
  return roundBankers(Math.max(0, worked - standardHours), 2)
}

/**
 * Minutos de tardanza: cuanto paso la entrada real de la hora esperada,
 * con un margen de gracia -10 minutos por defecto- antes de contar nada.
 * Llegar antes nunca da tardanza negativa.
 */
export function lateMinutes(checkIn: Date, expectedStart: Date, graceMinutes = 10): number {
  const minutos = Math.round((checkIn.getTime() - expectedStart.getTime()) / 60_000)
  return Math.max(0, minutos - graceMinutes)
}

/**
 * Republica Dominicana no observa horario de verano: siempre UTC-4.
 * Se usa un offset fijo -no Intl/timeZone- porque los checkIn son un
 * instante absoluto y el servidor puede correr en cualquier zona horaria
 * (ej. UTC en produccion); calcular "la hora esperada" con Date.setHours
 * usaria la zona del servidor, no la de RD, y daria tardanzas falsas.
 */
const OFFSET_RD_HORAS = -4

/** La hora esperada -ej. 8:00am- expresada en el mismo dia calendario de RD del marcaje. */
export function horaEsperadaEnRD(checkIn: Date, hora: number, minuto = 0): Date {
  const local = new Date(checkIn.getTime() + OFFSET_RD_HORAS * 3_600_000)
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      hora - OFFSET_RD_HORAS,
      minuto,
      0,
    ),
  )
}
