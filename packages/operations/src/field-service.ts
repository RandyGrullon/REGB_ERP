/**
 * Servicio en campo — §5.7, modulo 74 (F10/S69).
 *
 * Modulo movil-primero (§13.5): el tecnico no lleva laptop al sitio, lleva
 * el telefono. Eso cambia las reglas, no solo la pantalla:
 *
 *  - El checklist NO es decorativo: una orden no se cierra con pasos
 *    obligatorios sin marcar. Es lo unico que hace que "lo revise" sea
 *    verificable cuando el cliente reclama tres semanas despues.
 *  - La firma del cliente es la prueba de que el trabajo se recibio. Sin
 *    firma no hay cierre, punto -esa firma es lo que se enseña cuando
 *    alguien dice "aqui no vino nadie"-.
 *
 * Los dias que una orden lleva abierta reutilizan `diasAbierto()` de
 * `quality.ts` -cuarta vez esta fase que la misma resta mide lo mismo-, y
 * el avance del checklist reutiliza `tasaSobre()` de `marketing.ts`, que
 * ya devuelve `null` cuando no hay contra que comparar.
 */

export { diasAbierto as diasOrdenAbierta } from './quality.js'
export { tasaSobre as avanceChecklist } from './marketing.js'

export type EstadoOrdenServicio =
  | 'draft'
  | 'scheduled'
  | 'in_progress'
  | 'done'
  | 'cancelled'

const TRANSICIONES_ORDEN: Record<EstadoOrdenServicio, EstadoOrdenServicio[]> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'scheduled', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
}

/**
 * `scheduled → scheduled` es valido a proposito: reprogramar una visita
 * es lo mas normal del mundo en campo y no deberia obligar a cancelar la
 * orden y abrir otra -se perderia el historial de por que se movio-.
 */
export function transicionValidaOrden(
  actual: EstadoOrdenServicio,
  siguiente: EstadoOrdenServicio,
): boolean {
  return TRANSICIONES_ORDEN[actual].includes(siguiente)
}

export interface PasoChecklist {
  required: boolean
  done: boolean
}

/** Faltan pasos OBLIGATORIOS sin marcar. Los opcionales no bloquean. */
export function pasosObligatoriosPendientes(pasos: PasoChecklist[]): number {
  return pasos.filter((p) => p.required && !p.done).length
}

/**
 * La regla que sostiene el modulo: una orden se cierra con el checklist
 * obligatorio completo Y con la firma del cliente.
 *
 * Se devuelve el motivo en vez de un booleano pelado porque el tecnico
 * esta parado en el sitio con el telefono en la mano: "no se puede" sin
 * decir que falta lo obliga a adivinar.
 */
export function motivoNoCierre(pasos: PasoChecklist[], firmadoPor: string | null): string | null {
  const pendientes = pasosObligatoriosPendientes(pasos)
  if (pendientes > 0) {
    return pendientes === 1
      ? 'Falta marcar 1 paso obligatorio del checklist.'
      : `Faltan marcar ${pendientes} pasos obligatorios del checklist.`
  }
  if (firmadoPor === null || firmadoPor.trim() === '') {
    return 'Falta la firma de quien recibio el trabajo.'
  }
  return null
}

export function puedeCerrarOrden(pasos: PasoChecklist[], firmadoPor: string | null): boolean {
  return motivoNoCierre(pasos, firmadoPor) === null
}

/**
 * Costo de los repuestos usados en la visita.
 *
 * Se redondea al centavo al final y no pieza por pieza: redondear cada
 * linea y luego sumar arrastra el error hacia arriba cuando hay muchas
 * piezas baratas, que es justo el caso de una orden de servicio.
 */
export function costoRepuestos(lineas: { qty: number; unitCost: number }[]): number {
  const bruto = lineas.reduce((acc, l) => acc + l.qty * l.unitCost, 0)
  return Math.round(bruto * 100) / 100
}

/**
 * Minutos reales en sitio. `null` si la visita no ha terminado -no cero,
 * porque cero se confunde con "entro y salio"-.
 */
export function minutosEnSitio(inicio: Date, fin: Date | null): number | null {
  if (fin === null) return null
  return Math.max(0, Math.round((fin.getTime() - inicio.getTime()) / 60_000))
}
