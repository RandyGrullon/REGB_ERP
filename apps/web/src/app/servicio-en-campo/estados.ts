import { motivoNoCierre, pasosObligatoriosPendientes, type PasoChecklist } from '@regb/operations'

/** Etiquetas de estado de una orden de servicio. */
export const ESTADO_ORDEN: Record<string, string> = {
  draft: 'Borrador',
  scheduled: 'Agendada',
  in_progress: 'En sitio',
  done: 'Terminada',
  cancelled: 'Cancelada',
}

export const PRIORIDAD_ORDEN: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

/**
 * Por qué todavía no se puede cerrar la orden, en palabras del técnico.
 * La regla la decide `motivoNoCierre()` de @regb/operations; aquí solo
 * cambia cómo se dice (sin "checklist" y con tildes).
 */
export function motivoParaNoCerrar(
  pasos: PasoChecklist[],
  firmadoPor: string | null,
): string | null {
  if (motivoNoCierre(pasos, firmadoPor) === null) return null
  const pendientes = pasosObligatoriosPendientes(pasos)
  if (pendientes === 1) return 'Falta marcar 1 paso obligatorio.'
  if (pendientes > 1) return `Faltan ${pendientes} pasos obligatorios por marcar.`
  return 'Falta el nombre de quien recibió el trabajo.'
}
