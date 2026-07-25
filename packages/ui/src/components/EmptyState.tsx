import type { ReactNode } from 'react'
import { cn } from '../utils'

/**
 * Estado vacio con personalidad.
 *
 * Ley de Aurora (§11.5): ilustracion + frase con humor + accion primaria +
 * accion secundaria + enlace al tutorial. Nunca una tabla vacia muda.
 */
export interface EmptyStateProps {
  /** Emoji o icono. Grande y amable. */
  icon?: ReactNode
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
  icon = '📦',
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
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="text-5xl" aria-hidden>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h3>
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
            'mt-1 text-xs text-[var(--color-text-link)] underline-offset-4 hover:underline',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--color-brand-bright)]',
          )}
        >
          🎓 {tourLabel}
        </a>
      )}
    </div>
  )
}
