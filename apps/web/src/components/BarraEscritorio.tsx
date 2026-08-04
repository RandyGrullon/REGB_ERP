'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@regb/ui'

/**
 * Barra de estado de la app de escritorio (F5).
 *
 * Solo aparece cuando corremos dentro de Electron: en el navegador no
 * existe `window.regb` y el componente no pinta nada.
 *
 * Enseña lo unico que el cajero necesita saber sobre el offline —si hay
 * linea y cuantas ventas faltan por subir— porque la alternativa es que se
 * entere el dia del cierre. Un sistema que vende sin conexion y no lo dice
 * es peor que uno que no vende sin conexion: el cajero cree que todo esta
 * arriba y no lo esta.
 */

interface EstadoSync {
  pendientes: number
  atascadas: number
  ultimoIntento: string | null
  ultimoError: string | null
  subiendo: boolean
}

interface PuenteEscritorio {
  esEscritorio: true
  abrirGaveta: () => Promise<{ ok: boolean; error?: string }>
  estadoSync: () => Promise<EstadoSync>
  sincronizarAhora: () => Promise<EstadoSync>
  estadoRed: () => Promise<{ enLinea: boolean }>
  alCambiarSync: (cb: (e: EstadoSync) => void) => () => void
}

function puente(): PuenteEscritorio | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { regb?: PuenteEscritorio }).regb ?? null
}

export function BarraEscritorio() {
  const [estado, setEstado] = useState<EstadoSync | null>(null)
  const [enLinea, setEnLinea] = useState(true)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    const p = puente()
    if (!p) return

    void p.estadoSync().then(setEstado)
    void p.estadoRed().then((r) => setEnLinea(r.enLinea))
    const quitar = p.alCambiarSync(setEstado)

    // `net.isOnline()` del proceso principal mira trafico real, no el
    // cable: un router encendido sin internet no cuenta como en linea.
    const reloj = setInterval(() => void p.estadoRed().then((r) => setEnLinea(r.enLinea)), 10_000)
    return () => {
      quitar()
      clearInterval(reloj)
    }
  }, [])

  if (!puente()) return null

  const pendientes = estado?.pendientes ?? 0
  const atascadas = estado?.atascadas ?? 0

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm"
    >
      <span className="flex items-center gap-1.5">
        <Icon
          name={enLinea ? 'cloud_done' : 'cloud_off'}
          size={18}
          filled
          className={
            enLinea
              ? 'text-[var(--color-semantic-text-success)]'
              : 'text-[var(--color-semantic-text-warning)]'
          }
        />
        <span className="text-[var(--color-text-secondary)]">
          {enLinea ? 'En linea' : 'Sin conexion — se sigue vendiendo'}
        </span>
      </span>

      {pendientes > 0 && (
        <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
          <Icon name="sync" size={18} className={estado?.subiendo ? 'animate-spin' : ''} />
          <strong className="tabular text-[var(--color-text-primary)]">{pendientes}</strong>
          {pendientes === 1 ? 'venta por subir' : 'ventas por subir'}
        </span>
      )}

      {atascadas > 0 && (
        <span
          className="flex items-center gap-1.5 text-[var(--color-semantic-text-danger)]"
          title={estado?.ultimoError ?? ''}
        >
          <Icon name="error" size={18} filled />
          {atascadas} atascada{atascadas === 1 ? '' : 's'} — avisa a soporte
        </span>
      )}

      <span className="ml-auto flex items-center gap-2">
        {pendientes > 0 && (
          <button
            type="button"
            onClick={() => void puente()?.sincronizarAhora().then(setEstado)}
            className="flex h-9 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            <Icon name="cloud_upload" size={16} />
            Subir ahora
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            void puente()
              ?.abrirGaveta()
              .then((r) => setAviso(r.ok ? null : (r.error ?? 'No se pudo abrir la gaveta.')))
          }
          className="flex h-9 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          <Icon name="point_of_sale" size={16} />
          Abrir gaveta
        </button>
      </span>

      {aviso && (
        <p role="alert" className="w-full text-xs text-[var(--color-semantic-text-danger)]">
          {aviso}
        </p>
      )}
    </div>
  )
}
