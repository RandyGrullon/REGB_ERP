'use client'

import { useEffect } from 'react'
import { Icon } from '@regb/ui'

/**
 * Lo que ve alguien cuando una pantalla revienta.
 *
 * Antes no habia ninguna: Next pintaba "Application error: a server-side
 * exception has occurred" en blanco, sin menu, sin forma de volver, y el
 * cajero creia que el sistema se habia caido entero.
 *
 * Esto no arregla el fallo -eso es trabajo de la accion que lanzo, que
 * deberia devolver un error legible-, pero deja a la persona dentro del
 * ERP, le dice que su trabajo anterior sigue guardado y le da el codigo
 * que soporte necesita para encontrar el error en los logs.
 */
export default function ErrorDePantalla({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="grid h-full place-items-center bg-[var(--color-surface-base)] p-6">
      <div
        role="alert"
        className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 text-center"
      >
        <Icon name="report" size={40} className="text-[var(--color-semantic-text-danger)]" />
        <h1 className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">
          Esta pantalla tuvo un problema
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Lo que ya guardaste sigue guardado. Puedes intentarlo de nuevo; si vuelve a pasar,
          comparte el código de abajo con soporte.
        </p>
        {error.digest && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-[var(--color-text-muted)]">
            Código: {error.digest}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="h-10 rounded-[var(--radius-full)] bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Intentar de nuevo
          </button>
          <a
            href="/"
            className="grid h-10 place-items-center rounded-[var(--radius-full)] border border-[var(--color-border)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Ir al inicio
          </a>
        </div>
      </div>
    </div>
  )
}
