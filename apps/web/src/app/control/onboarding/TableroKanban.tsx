'use client'

import Link from 'next/link'
import { startTransition, useEffect, useOptimistic, useState, type DragEvent } from 'react'
import { Badge, Icon } from '@regb/ui'
import { moverEtapaTablero } from './actions'
import { EnlaceNuevoDueno } from './EnlaceDueno'
import {
  destinoConTeclado,
  ETAPAS,
  nombreDeEtapa,
  TAMANO_TEXTO,
  TAMANO_TONO,
  type EtapaId,
  type TarjetaOnboarding,
} from './tablero'

/**
 * El Kanban de onboarding. 'use client' porque arrastrar, el movimiento
 * optimista y el foco que sigue a la tarjeta son cosas del navegador.
 *
 * Tres formas de mover, porque arrastrar NO puede ser la unica (teclado,
 * lector de pantalla, telefono):
 *  1. Arrastrar la tarjeta a otra columna (HTML5 drag & drop, sin
 *     librerias): la columna destino se marca mientras pasas por encima.
 *  2. Con la tarjeta enfocada, flecha izquierda/derecha: etapa vecina.
 *  3. "Mover a..." en cada tarjeta: un <select> nativo, que en el telefono
 *     abre la rueda del sistema.
 * La tarjeta cambia de columna al instante (useOptimistic) y, si el
 * servidor lo rechaza, vuelve sola a donde estaba y se dice por que. El
 * resultado se anuncia en una region aria-live.
 */

const MIME = 'application/x-regb-tenant'

export function TableroKanban({
  tarjetas,
  hayFiltro,
}: {
  tarjetas: TarjetaOnboarding[]
  hayFiltro: boolean
}) {
  const [vistas, mover] = useOptimistic(tarjetas, (actual, m: { id: string; stage: EtapaId }) =>
    actual.map((t) => (t.tenant_id === m.id ? { ...t, stage: m.stage } : t)),
  )
  const [anuncio, setAnuncio] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [destino, setDestino] = useState<EtapaId | null>(null)
  /** Tras mover con el teclado, el foco sigue a la tarjeta a su columna nueva. */
  const [enfocar, setEnfocar] = useState<string | null>(null)

  useEffect(() => {
    if (enfocar === null) return
    document.getElementById(`tarjeta-${enfocar}`)?.focus()
  }, [enfocar, vistas])

  function moverA(t: TarjetaOnboarding, stage: EtapaId, conTeclado = false) {
    if (t.stage === stage) return
    setError(null)
    if (conTeclado) setEnfocar(t.tenant_id)
    startTransition(async () => {
      mover({ id: t.tenant_id, stage })
      const fd = new FormData()
      fd.set('tenantId', t.tenant_id)
      fd.set('stage', stage)
      try {
        const r = await moverEtapaTablero(fd)
        if (r.ok) {
          setAnuncio(`${t.legal_name} paso a ${nombreDeEtapa(r.stage)}.`)
        } else {
          // useOptimistic devuelve la tarjeta a su columna al terminar.
          setError(`No movimos ${t.legal_name}: ${r.error}`)
          setAnuncio(`No se movio ${t.legal_name}. Sigue en ${nombreDeEtapa(t.stage)}.`)
        }
      } catch {
        setError(
          `No movimos ${t.legal_name}: se perdio la conexion. Sigue en ${nombreDeEtapa(t.stage)}.`,
        )
        setAnuncio(`No se movio ${t.legal_name}.`)
      }
    })
  }

  function soltar(e: DragEvent<HTMLElement>, stage: EtapaId) {
    e.preventDefault()
    const id = e.dataTransfer.getData(MIME)
    setDestino(null)
    setArrastrando(null)
    const t = vistas.find((x) => x.tenant_id === id)
    if (t) moverA(t, stage)
  }

  return (
    <div className="space-y-3">
      {/* Lo que paso, para quien no ve la tarjeta moverse. */}
      <p role="status" aria-live="polite" className="sr-only">
        {anuncio}
      </p>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-semantic-danger)] px-3 py-2 text-sm text-[var(--color-semantic-text-danger)]"
        >
          <Icon name="error" size={18} />
          <p className="flex-1">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Cerrar el aviso"
            className="grid h-7 w-7 place-items-center rounded-full hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <p id="ayuda-tablero" className="text-xs text-[var(--color-text-muted)]">
        Arrastra una tarjeta a otra columna, o enfocala y usa las flechas izquierda y derecha. En el
        telefono, usa &quot;Mover a&quot;.
      </p>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {ETAPAS.map((etapa) => {
          const cards = vistas.filter((c) => c.stage === etapa.id)
          const esDestino = destino === etapa.id && arrastrando !== null
          return (
            <section
              key={etapa.id}
              aria-label={`${etapa.label}: ${cards.length} ${cards.length === 1 ? 'cliente' : 'clientes'}`}
              onDragOver={(e) => {
                // Solo tarjetas del tablero: un archivo o un texto arrastrado
                // desde fuera no marca columnas.
                if (!Array.from(e.dataTransfer.types).includes(MIME)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (destino !== etapa.id) setDestino(etapa.id)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDestino(null)
              }}
              onDrop={(e) => soltar(e, etapa.id)}
              className={`min-h-40 rounded-[var(--radius-lg)] p-2 transition-colors duration-150 ${
                esDestino
                  ? 'bg-[var(--color-brand-soft)] outline-2 outline-dashed outline-offset-[-2px] outline-[var(--color-brand)]'
                  : 'bg-[var(--color-surface-deep)]'
              }`}
            >
              <h2 className="flex items-center justify-between px-2 py-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                {etapa.label}
                <Badge dot={false}>{cards.length}</Badge>
              </h2>
              <div className="mt-1 space-y-2">
                {cards.map((c) => (
                  <Tarjeta
                    key={c.tenant_id}
                    c={c}
                    arrastrando={arrastrando === c.tenant_id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(MIME, c.tenant_id)
                      e.dataTransfer.setData('text/plain', c.legal_name)
                      e.dataTransfer.effectAllowed = 'move'
                      setArrastrando(c.tenant_id)
                    }}
                    onDragEnd={() => {
                      setArrastrando(null)
                      setDestino(null)
                    }}
                    moverA={moverA}
                  />
                ))}
                {cards.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-[var(--color-text-muted)]">
                    {esDestino
                      ? 'Suelta aquí'
                      : hayFiltro
                        ? 'Ningún cliente del filtro en esta etapa'
                        : 'Sin clientes en esta etapa'}
                  </p>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Tarjeta({
  c,
  arrastrando,
  onDragStart,
  onDragEnd,
  moverA,
}: {
  c: TarjetaOnboarding
  arrastrando: boolean
  onDragStart: (e: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  moverA: (t: TarjetaOnboarding, stage: EtapaId, conTeclado?: boolean) => void
}) {
  const i = ETAPAS.findIndex((e) => e.id === c.stage)
  const anterior = ETAPAS[i - 1]
  const siguiente = ETAPAS[i + 1]

  return (
    <article
      id={`tarjeta-${c.tenant_id}`}
      tabIndex={0}
      draggable
      aria-roledescription="tarjeta movible"
      aria-label={`${c.legal_name}, ${TAMANO_TEXTO[c.tier]}, en ${nombreDeEtapa(c.stage)}`}
      aria-describedby="ayuda-tablero"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        // Solo con la tarjeta misma enfocada: dentro del select o de un
        // boton, las flechas son de ellos.
        if (e.target !== e.currentTarget) return
        const d = destinoConTeclado(c.stage, e.key)
        if (d) {
          e.preventDefault()
          moverA(c, d, true)
        }
      }}
      className={`cursor-grab rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 transition-opacity active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] ${
        arrastrando ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon
          name="drag_indicator"
          size={16}
          className="mt-0.5 shrink-0 text-[var(--color-text-muted)]"
        />
        <Link
          href={`/control/${c.slug}`}
          draggable={false}
          className="text-sm font-semibold text-[var(--color-text-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          {c.legal_name}
        </Link>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Badge tone={TAMANO_TONO[c.tier]}>{TAMANO_TEXTO[c.tier].toUpperCase()}</Badge>
        {c.blockers && (
          <Badge tone="warning" dot={false} title={c.blockers}>
            bloqueado
          </Badge>
        )}
        {c.dueno_pendiente && (
          <Badge tone="info" dot={false} title="La invitacion Owner esta pendiente">
            dueño sin entrar
          </Badge>
        )}
      </div>
      {c.dueno_pendiente && (
        <div className="mt-2">
          <EnlaceNuevoDueno clienteId={c.tenant_id} nombre={c.legal_name} />
        </div>
      )}
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          disabled={!anterior}
          onClick={() => anterior && moverA(c, anterior.id)}
          aria-label={
            anterior ? `Mover ${c.legal_name} a ${anterior.label}` : 'Ya esta en la primera etapa'
          }
          className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:opacity-30"
        >
          <Icon name="arrow_back" size={16} />
        </button>
        <label className="sr-only" htmlFor={`mover-${c.tenant_id}`}>
          Mover {c.legal_name} a otra etapa
        </label>
        <select
          id={`mover-${c.tenant_id}`}
          value=""
          onChange={(e) => {
            const v = e.target.value as EtapaId
            if (v) moverA(c, v)
          }}
          className="h-8 min-w-0 flex-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-xs text-[var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          <option value="">Mover a…</option>
          {ETAPAS.filter((e) => e.id !== c.stage).map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!siguiente}
          onClick={() => siguiente && moverA(c, siguiente.id)}
          aria-label={
            siguiente ? `Mover ${c.legal_name} a ${siguiente.label}` : 'Ya esta en la última etapa'
          }
          className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:opacity-30"
        >
          <Icon name="arrow_forward" size={16} />
        </button>
      </div>
    </article>
  )
}
