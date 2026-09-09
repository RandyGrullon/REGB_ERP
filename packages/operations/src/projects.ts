export { certificadoVigente as hitoVigente } from './training.js'

export type EstadoProyecto = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'

const TRANSICIONES_PROYECTO: Record<EstadoProyecto, EstadoProyecto[]> = {
  planning: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
}

export function transicionValidaProyecto(actual: EstadoProyecto, siguiente: EstadoProyecto): boolean {
  return TRANSICIONES_PROYECTO[actual].includes(siguiente)
}

export type EstadoTarea = 'todo' | 'in_progress' | 'done' | 'blocked'

const TRANSICIONES_TAREA: Record<EstadoTarea, EstadoTarea[]> = {
  todo: ['in_progress', 'blocked'],
  in_progress: ['done', 'blocked', 'todo'],
  blocked: ['todo', 'in_progress'],
  done: ['in_progress'],
}

export function transicionValidaTarea(actual: EstadoTarea, siguiente: EstadoTarea): boolean {
  return TRANSICIONES_TAREA[actual].includes(siguiente)
}

/** Una tarea no puede avanzar a en curso o hecha si alguna dependencia todavia no esta hecha. */
export function puedeAvanzarPorDependencias(estadosDependencias: EstadoTarea[], siguiente: EstadoTarea): boolean {
  if (siguiente !== 'in_progress' && siguiente !== 'done') return true
  return estadosDependencias.every((e) => e === 'done')
}
