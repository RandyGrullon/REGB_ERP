import type { ReactNode } from 'react'
import { cn } from '../utils'
import { Icon } from './Icon'

/**
 * Estado vacio con personalidad.
 *
 * Ley de Aurora (§11.5): ilustracion + frase con humor + accion primaria +
 * accion secundaria + enlace al tutorial. Nunca una tabla vacia muda.
 */
export interface EmptyStateProps {
  /**
   * Nombre de un icono Material Symbols (`inventory_2`). SOLO el nombre:
   * antes admitia tambien un nodo suelto y por ahi se colaban emojis, que
   * dejan el producto sin iconografia coherente (y cada sistema los pinta
   * distinto).
   */
  icon?: string
  title: string
  /** Con humor, en espanol dominicano. */
  description: string
  action?: ReactNode
  secondaryAction?: ReactNode
  /** "¿Primera vez? Tour de 6 min" */
  tourHref?: string
  tourLabel?: string
  className?: string
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  secondaryAction,
  tourHref,
  tourLabel = 'Ver tutorial',
  className,
}: EmptyStateProps) {
  return (
    <div
      // Marca para `scripts/revision-pantallas.mjs`: cuenta que pantallas
      // salen vacias con los datos de la demo. No cambia nada visible.
      data-estado="vacio"
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <span
        aria-hidden
        className="grid h-16 w-16 place-items-center rounded-full bg-[var(--color-surface-raised)]"
      >
        <Icon name={icon} size={32} className="text-[var(--color-text-muted)]" />
      </span>

      {/* h2, no h3: cuelga directamente del h1 de la pantalla. Con h3
          quedaba el salto h1 -> h3 y un lector lo anuncia como si faltara
          una seccion entera. */}
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
      <p className="max-w-sm text-sm text-[var(--color-text-secondary)]">{description}</p>

      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}

      {tourHref && (
        <a
          href={tourHref}
          className={cn(
            'mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--color-text-link)]',
            'underline-offset-4 hover:underline',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--color-brand-bright)]',
          )}
        >
          <Icon name="school" size={14} />
          {tourLabel}
        </a>
      )}
    </div>
  )
}
