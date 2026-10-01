/**
 * Fechas y horas como las lee alguien en República Dominicana.
 *
 * Una columna `date` de Postgres llega como '2026-10-14'. `new Date()` la
 * toma como medianoche UTC y, al pintarla con la hora de RD (UTC-4), sale
 * el día ANTERIOR: el proyecto que vence el 14 decía "13/10/2026". Aquí la
 * fecha se arma y se pinta en UTC, así el día que se ve es el que se guardó.
 *
 * Los instantes (`timestamptz`) sí son horas reales: se pintan en la zona
 * de RD, sin depender de la zona del servidor.
 */

const ZONA_RD = 'America/Santo_Domingo'

function desdeFecha(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}

/** '2026-10-14' → '14 oct' (o '14 oct 2026' con `anio`). */
export function fechaCorta(iso: string, anio = false): string {
  return desdeFecha(iso).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    ...(anio ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

/** Un instante en hora de RD: '26 sept, 09:30 a. m.' */
export function fechaHoraRD(iso: string): string {
  return new Date(iso).toLocaleString('es-DO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONA_RD,
  })
}

/** El día de hoy en RD, como 'YYYY-MM-DD'. */
export function hoyRD(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: ZONA_RD })
}

/** El día (en RD) de un instante, como 'YYYY-MM-DD'. */
export function diaRD(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONA_RD })
}

/** ¿Una fecha límite ya pasó? Vence HOY no es vencida. */
export function yaVencio(iso: string, ahora: Date = new Date()): boolean {
  return iso.slice(0, 10) < hoyRD(ahora)
}

/** Días enteros entre dos fechas 'YYYY-MM-DD' (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((desdeFecha(b).getTime() - desdeFecha(a).getTime()) / 86_400_000)
}

/** 10.22 → '10 h 13 min'; 2 → '2 h'; 0.5 → '30 min'. */
export function horasEnTexto(horas: number): string {
  const totalMin = Math.round(horas * 60)
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (h === 0) return `${min} min`
  return min === 0 ? `${h} h` : `${h} h ${min} min`
}

/** 24 → '24'; 7.5 → '7.5': horas sin ceros de sobra. */
export function horasCortas(horas: number): string {
  return Number.isInteger(horas) ? String(horas) : String(Math.round(horas * 100) / 100)
}
