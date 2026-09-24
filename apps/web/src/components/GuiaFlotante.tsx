'use client'

import { useEffect, useMemo, useState } from 'react'
import { pasoDesdeGuia } from '@/app/tutorial/actions'
import { BotonEnvio } from '@/components/BotonEnvio'

/**
 * La guia que acompaña al tour DENTRO de la pantalla de destino.
 *
 * ── El hueco que cierra ───────────────────────────────────────────────
 *
 * El tutorial (§2, fila 5) promete un tour "interactivo". Lo que habia
 * era una lista guiada: leias el paso en /tutorial, pulsabas "Hazlo
 * ahora" y aterrizabas en la pantalla real... sin el paso. Para seguir
 * habia que volver atras, leer el siguiente y volver a salir. Nadie
 * termina un tutorial asi, y un tutorial que nadie termina es el
 * consultor de implementacion que el producto decia no necesitar.
 *
 * Ahora el paso viaja en la URL y se pinta aqui, encima de la pantalla
 * de verdad, con el boton de avanzar al lado.
 *
 * ── Por que `data-tour` y no un selector CSS ──────────────────────────
 *
 * El paso declara `target: 'boton-nuevo'` y aqui se busca
 * `[data-tour="boton-nuevo"]`. Dejar que el contenido traiga un selector
 * CSS crudo seria dejar que el texto de un tour apunte a cualquier cosa
 * del documento, y ese texto es dato editable. Con el atributo, lo unico
 * alcanzable es lo que la UI marco a proposito.
 *
 * Si el ancla no existe -todavia no estan puestas en toda la UI-, la
 * guia sale igual sin resaltar nada. Degrada, no se rompe.
 */
export interface PasoGuia {
  tourId: string
  titulo: string
  cuerpo: string
  tip?: string | undefined
  /** Valor de `data-tour` del elemento a resaltar. Opcional. */
  target?: string | undefined
  paso: number
  total: number
  /** A donde va "Siguiente". Null en el ultimo paso. */
  siguiente: string | null
  /** Vuelta al tutorial, con el tour abierto. */
  tutorial: string
}

export function GuiaFlotante({ guia }: { guia: PasoGuia }) {
  const [oculta, setOculta] = useState(false)
  // En demo el negocio y el rol viajan en la URL; la accion los necesita.
  const demo = useMemo(() => {
    const q = new URLSearchParams(guia.tutorial.split('?')[1] ?? '')
    return { tenant: q.get('tenant') ?? '', rol: q.get('rol') ?? '' }
  }, [guia.tutorial])

  useEffect(() => {
    if (guia.target === undefined || oculta) return
    const el = document.querySelector(`[data-tour="${CSS.escape(guia.target)}"]`)
    if (!(el instanceof HTMLElement)) {
      // Un paso sin su ancla en la pantalla es trabajo pendiente nuestro, no
      // algo que el cliente deba leer: antes salia en la tarjeta.
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[guía] falta data-tour="${guia.target}" en esta pantalla`)
      }
      return
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('guia-resaltado')
    return () => el.classList.remove('guia-resaltado')
  }, [guia.target, guia.paso, oculta])

  if (oculta) return null

  return (
    <>
      {/*
        El resaltado se hace con una sombra hacia afuera y no con un
        overlay oscuro a pantalla completa: el overlay taparia el propio
        elemento que se quiere señalar en cuanto tenga fondo propio, y
        ademas bloquea el clic -que es justo lo que el paso pide hacer-.
      */}
      <style>{`
        .guia-resaltado {
          position: relative;
          z-index: 45;
          border-radius: var(--radius-md);
          box-shadow: 0 0 0 3px var(--color-brand), 0 0 0 9999px rgba(0, 0, 0, 0.35);
        }
        @media (prefers-reduced-motion: reduce) {
          .guia-resaltado { box-shadow: 0 0 0 3px var(--color-brand); }
        }
      `}</style>

      <aside
        role="complementary"
        aria-label={`Tutorial, paso ${guia.paso} de ${guia.total}`}
        className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-lg sm:inset-x-auto sm:right-4"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[var(--color-text-muted)]">
              Tutorial · paso {guia.paso} de {guia.total}
            </p>
            <h2 className="mt-1 truncate font-medium text-[var(--color-text-primary)]">
              {guia.titulo}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{guia.cuerpo}</p>
            {guia.tip !== undefined && (
              <p className="mt-2 border-l-2 border-[var(--color-brand)] pl-3 text-xs text-[var(--color-text-secondary)]">
                <strong>De quien ya paso por esto:</strong> {guia.tip}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOculta(true)}
            aria-label="Ocultar la guia"
            className="h-8 w-8 shrink-0 rounded-[var(--radius-md)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            ✕
          </button>
        </div>

        {/* La barra de avance, que es lo que hace que se termine. */}
        <div
          className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-overlay)]"
          role="progressbar"
          aria-valuenow={guia.paso}
          aria-valuemin={1}
          aria-valuemax={guia.total}
        >
          <div
            className="h-full bg-[var(--color-brand)]"
            style={{ width: `${(guia.paso / guia.total) * 100}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Guarda el avance y despues navega: con un enlace, recorrer
              las pantallas no contaba para nada. */}
          <form action={pasoDesdeGuia}>
            <input type="hidden" name="tenant" value={demo.tenant} />
            <input type="hidden" name="rol" value={demo.rol} />
            <input type="hidden" name="tourId" value={guia.tourId} />
            <input type="hidden" name="step" value={guia.paso - 1} />
            <input type="hidden" name="destino" value={guia.siguiente ?? guia.tutorial} />
            <BotonEnvio className="h-9 rounded-full bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
              {guia.siguiente !== null
                ? 'Siguiente paso'
                : guia.paso >= guia.total
                  ? 'Terminar el tour'
                  : 'Seguir en el tutorial'}
            </BotonEnvio>
          </form>
          <a
            href={guia.tutorial}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm leading-9 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Volver al tutorial
          </a>
        </div>
      </aside>
    </>
  )
}
