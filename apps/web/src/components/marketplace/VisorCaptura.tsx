'use client'

import { useEffect, useRef } from 'react'
import { Icon, cn } from '@regb/ui'
import type { CatalogEntry } from '@/lib/catalog'
import { CapturaModulo } from './CapturaModulo'
import { FOCO } from './formato'

/**
 * La captura en grande.
 *
 * `<dialog>` nativo con `showModal()` y no un div flotante, porque el
 * navegador ya resuelve lo dificil y lo resuelve bien: el resto de la
 * pagina queda inerte (el foco no se escapa con Tab), Esc cierra, y el
 * lector de pantalla lo anuncia como dialogo modal. Al cerrar, el foco
 * vuelve al boton que lo abrio.
 *
 * Clic fuera de la imagen (en el fondo) tambien cierra.
 */
export function VisorCaptura({
  mod,
  abierto,
  onCerrar,
}: {
  mod: Pick<CatalogEntry, 'id' | 'name' | 'icon' | 'category' | 'isPublished' | 'screenshots'>
  abierto: boolean
  onCerrar: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const cerrar = useRef<HTMLButtonElement>(null)
  const volverA = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (abierto && !d.open) {
      volverA.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      d.showModal()
      // showModal ya enfoca el primer control, que es este; se hace
      // explicito para no depender de esa regla del navegador.
      cerrar.current?.focus()
    } else if (!abierto && d.open) {
      d.close()
    }
  }, [abierto])

  return (
    <dialog
      ref={ref}
      aria-labelledby="visor-titulo"
      onClose={() => {
        onCerrar()
        volverA.current?.focus()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close()
      }}
      className="m-auto w-[min(1280px,calc(100vw_-_2rem),calc((100dvh_-_7rem)_*_1.6))] max-w-none overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-base)] p-0 text-[var(--color-text-primary)] backdrop:bg-black/70"
    >
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] py-1.5 pl-4 pr-1.5">
        <h2 id="visor-titulo" className="min-w-0 flex-1 truncate text-sm font-semibold">
          Pantalla de {mod.name}
        </h2>
        <button
          ref={cerrar}
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Cerrar"
          className={cn(
            'grid h-11 w-11 place-items-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] md:h-9 md:w-9',
            FOCO,
          )}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      {abierto && (
        <CapturaModulo
          mod={mod}
          ajuste="contain"
          grande
          className="aspect-[16/10] w-full bg-[var(--color-surface-deepest)]"
        />
      )}
      <p className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
        Captura real de la app con datos de demostración · Esc para cerrar
      </p>
    </dialog>
  )
}
