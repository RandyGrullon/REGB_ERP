import type { ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '../utils'
import { Icon } from './Icon'

/**
 * Barra de filtros de una pantalla de lista.
 *
 * Es un `<form method="get">`: los filtros viajan en la URL, asi que se
 * pueden compartir por enlace, sobreviven a recargar y funcionan sin
 * JavaScript. Un filtro que vive solo en el estado de React se pierde en
 * cuanto el usuario refresca — y en un ERP la gente refresca.
 */

export interface ToolbarProps {
  /** Campos ocultos que hay que arrastrar (tenant y rol en demostracion). */
  hidden?: Record<string, string>
  children: ReactNode
  className?: string
}

export function Toolbar({ hidden, children, className }: ToolbarProps) {
  return (
    <form
      method="get"
      className={cn(
        'flex flex-wrap items-end gap-2 rounded-[var(--radius-lg)]',
        'border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3',
        className,
      )}
    >
      {hidden &&
        Object.entries(hidden)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
    </form>
  )
}

/** Buscador con lupa. `name` viaja en la URL. */
export function SearchField({
  name = 'q',
  defaultValue,
  placeholder = 'Buscar…',
  label = 'Buscar',
  className,
}: {
  name?: string
  defaultValue?: string
  placeholder?: string
  label?: string
  className?: string
}) {
  return (
    <label className={cn('flex min-w-52 flex-1 flex-col gap-1', className)}>
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      <span className="relative flex items-center">
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute left-2.5 text-[var(--color-text-muted)]"
        />
        <input
          type="search"
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={cn(
            'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)]',
            'bg-[var(--color-surface-input)] pl-9 pr-3 text-sm text-[var(--color-text-primary)]',
            'placeholder:text-[var(--color-text-muted)]',
            'focus-visible:outline-2 focus-visible:outline-offset-1',
            'focus-visible:outline-[var(--color-brand-bright)]',
          )}
        />
      </span>
    </label>
  )
}

/** Desplegable de filtro, con la misma altura que el buscador. */
export function FilterSelect({
  label,
  className,
  children,
  ...props
}: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={cn('flex w-44 flex-col gap-1', className)}>
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      <select
        {...props}
        className={cn(
          'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)]',
          'bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]',
          'focus-visible:outline-2 focus-visible:outline-offset-1',
          'focus-visible:outline-[var(--color-brand-bright)]',
        )}
      >
        {children}
      </select>
    </label>
  )
}

/** Boton de aplicar filtros + enlace para limpiarlos. */
export function ToolbarActions({
  clearHref,
  hasFilters,
  label = 'Filtrar',
}: {
  clearHref?: string
  hasFilters?: boolean
  label?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="submit"
        className={cn(
          'flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] px-4',
          'bg-[var(--color-brand)] text-sm font-medium text-[var(--color-text-on-brand)]',
          'transition-colors duration-100 hover:bg-[var(--color-brand-hover)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[var(--color-brand-bright)]',
        )}
      >
        <Icon name="filter_alt" size={16} />
        {label}
      </button>
      {hasFilters && clearHref && (
        <a
          href={clearHref}
          className="flex h-10 items-center gap-1 rounded-[var(--radius-md)] px-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)]"
        >
          <Icon name="close" size={16} />
          Limpiar
        </a>
      )}
    </div>
  )
}
