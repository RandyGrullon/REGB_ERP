import type { ReactNode } from 'react'
import { cn } from '../utils'
import { Icon } from './Icon'

/**
 * Encabezado de pagina — titulo, migas, descripcion y acciones.
 *
 * Existe para que las 20 pantallas no repitan el mismo bloque con seis
 * variantes distintas de tamano y separacion. Cuando haya que cambiar la
 * jerarquia tipografica, se cambia aqui.
 */
export interface Crumb {
  label: string
  href?: string
}

export interface PageHeaderProps {
  title: string
  description?: string | undefined
  /** Icono Material Symbols en pastilla, a la izquierda del titulo. */
  icon?: string | undefined
  crumbs?: Crumb[] | undefined
  /** Botones a la derecha. */
  actions?: ReactNode
  /** Contadores o pestanas bajo el titulo. */
  meta?: ReactNode
  className?: string | undefined
}

export function PageHeader({
  title,
  description,
  icon,
  crumbs,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('space-y-3', className)}>
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Miga de pan">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-[var(--color-text-muted)]">
            {crumbs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && (
                  <Icon name="chevron_right" size={14} className="text-[var(--color-text-muted)]" />
                )}
                {c.href ? (
                  <a
                    href={c.href}
                    className="rounded-[var(--radius-sm)] text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                  >
                    {c.label}
                  </a>
                ) : (
                  <span>{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-brand-soft)]"
          >
            <Icon name={icon} size={22} className="text-[var(--color-brand-bright)]" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
              {description}
            </p>
          )}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {meta}
    </header>
  )
}
