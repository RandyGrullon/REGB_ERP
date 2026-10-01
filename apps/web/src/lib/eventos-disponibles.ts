import 'server-only'

import { MANIFESTS } from './bootstrap'
import { nombreEvento } from './eventos'

export interface GrupoDeEventos {
  modulo: string
  eventos: { tipo: string; nombre: string }[]
}

/**
 * Los eventos que puede emitir ESTE negocio, agrupados por módulo y en
 * castellano, para elegirlos de una lista en vez de escribir
 * `modulo.entidad.accion` a mano. Salen de los manifests de los módulos
 * activos: un módulo apagado no emite nada, así que no se ofrece.
 */
export function eventosDisponibles(modulosActivos: Iterable<string>): GrupoDeEventos[] {
  const activos = new Set(modulosActivos)
  const grupos: GrupoDeEventos[] = []
  for (const m of MANIFESTS.values()) {
    if (!activos.has(m.id)) continue
    const emite = m.events?.emits ?? []
    if (emite.length === 0) continue
    grupos.push({
      modulo: m.name,
      eventos: emite
        .map((tipo) => ({ tipo, nombre: nombreEvento(tipo) }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    })
  }
  return grupos.sort((a, b) => a.modulo.localeCompare(b.modulo, 'es'))
}
