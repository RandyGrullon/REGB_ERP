'use client'

import { cn } from '../utils'

/**
 * Rail de empresas — 60px, la columna mas profunda.
 *
 * Una empresa (RNC) por ficha. Las fichas son CUADRADAS con esquinas
 * discretas, no circulos que se deforman al pasar el raton: un ERP donde
 * cada empresa es una razon social distinta se lee mejor con formas
 * estables. El activo se marca con una barra en color de marca a la
 * izquierda, y el resto baja de opacidad.
 */
export interface RailItem {
  id: string
  name: string
  /** Iniciales si no hay logo. */
  initials: string
  logoUrl?: string
  /** Notificaciones sin leer de esa empresa. */
  badge?: number
}

export interface ServerRailProps {
  items: RailItem[]
  activeId: string
  onSelect?: (id: string) => void
  onAdd?: () => void
  className?: string
}

export function ServerRail({ items, activeId, onSelect, onAdd, className }: ServerRailProps) {
  return (
    <nav
      aria-label="Empresas"
      className={cn(
        'flex w-[60px] shrink-0 flex-col items-center gap-1.5 py-2',
        'bg-[var(--color-surface-deepest)]',
        'border-r border-[var(--color-border)]',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <div key={item.id} className="relative flex w-full justify-center">
            {/* Barra del activo, en color de marca */}
            <span
              aria-hidden
              className={cn(
                'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-sm',
                'bg-[var(--color-brand-bright)] transition-all duration-100',
                active ? 'h-8' : 'h-0',
              )}
            />
            <button
              type="button"
              onClick={() => onSelect?.(item.id)}
              aria-current={active ? 'true' : undefined}
              title={item.name}
              className={cn(
                'grid h-10 w-10 place-items-center overflow-hidden',
                'rounded-[var(--radius-md)] text-[13px] font-semibold',
                'transition-colors duration-100',
                'focus-visible:outline-2 focus-visible:outline-offset-2',
                'focus-visible:outline-[var(--color-brand-bright)]',
                active
                  ? 'bg-[var(--color-brand)] text-[var(--color-text-on-brand)]'
                  : 'bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)]',
              )}
            >
              {item.logoUrl ? (
                // `img` a proposito y no `next/image`: este paquete lo comparten
                // web, Electron y (via ui-native) React Native. No puede depender
                // de Next.
                <img src={item.logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                item.initials
              )}
              <span className="sr-only">{item.name}</span>
            </button>

            {item.badge ? (
              <span
                className={cn(
                  'absolute -top-0.5 right-2 grid min-w-4 place-items-center',
                  'rounded-[var(--radius-sm)] px-1 text-[10px] font-bold',
                  'bg-[var(--color-semantic-danger)] text-white',
                  'ring-2 ring-[var(--color-surface-deepest)]',
                )}
              >
                {item.badge > 99 ? '99+' : item.badge}
                <span className="sr-only">notificaciones sin leer</span>
              </span>
            ) : null}
          </div>
        )
      })}

      {onAdd && (
        <>
          <span className="my-1 h-px w-7 bg-[var(--color-border)]" aria-hidden />
          <button
            type="button"
            onClick={onAdd}
            title="Agregar empresa"
            className={cn(
              'grid h-10 w-10 place-items-center rounded-[var(--radius-md)]',
              'border border-dashed border-[var(--color-border-strong)]',
              'text-lg text-[var(--color-text-muted)]',
              'transition-colors duration-100',
              'hover:border-[var(--color-brand-bright)] hover:text-[var(--color-brand-bright)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              'focus-visible:outline-[var(--color-brand-bright)]',
            )}
          >
            <span aria-hidden>+</span>
            <span className="sr-only">Agregar empresa</span>
          </button>
        </>
      )}
    </nav>
  )
}
