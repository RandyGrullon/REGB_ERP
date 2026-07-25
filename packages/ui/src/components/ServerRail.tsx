'use client'

import { cn } from '../utils'

/**
 * Rail de empresas — 72px, la columna mas oscura.
 *
 * Una empresa (RNC) por icono, como los servidores de Discord. La activa
 * lleva una pildora blanca a la izquierda y esquinas cuadradas; el resto
 * son circulos que se redondean menos al pasar el raton.
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
        'flex w-[72px] shrink-0 flex-col items-center gap-2 py-3',
        'bg-[var(--color-surface-deepest)]',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId
        return (
          <div key={item.id} className="relative flex w-full justify-center">
            {/* La pildora del activo — el detalle mas reconocible de Discord */}
            <span
              aria-hidden
              className={cn(
                'absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-white',
                'transition-all duration-150',
                active ? 'h-10' : 'h-0 group-hover:h-5',
              )}
            />
            <button
              type="button"
              onClick={() => onSelect?.(item.id)}
              aria-current={active ? 'true' : undefined}
              title={item.name}
              className={cn(
                'group relative grid h-12 w-12 place-items-center overflow-hidden',
                'text-sm font-semibold transition-all duration-150 ease-out',
                'focus-visible:outline-2 focus-visible:outline-offset-2',
                'focus-visible:outline-[var(--color-brand-bright)]',
                active
                  ? 'rounded-[var(--radius-lg)] bg-[var(--color-brand)] text-white'
                  : 'rounded-[var(--radius-full)] bg-[var(--color-surface-deep)] text-[var(--color-text-secondary)] hover:rounded-[var(--radius-lg)] hover:bg-[var(--color-brand)] hover:text-white',
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
                  'absolute -bottom-0.5 right-3 grid min-w-4 place-items-center rounded-full',
                  'bg-[var(--color-semantic-danger)] px-1 text-[10px] font-bold text-white',
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
          <span className="my-1 h-px w-8 bg-[var(--color-border)]" aria-hidden />
          <button
            type="button"
            onClick={onAdd}
            title="Agregar empresa"
            className={cn(
              'grid h-12 w-12 place-items-center rounded-[var(--radius-full)]',
              'bg-[var(--color-surface-deep)] text-xl text-[var(--color-semantic-success)]',
              'transition-all duration-150 hover:rounded-[var(--radius-lg)]',
              'hover:bg-[var(--color-semantic-success)] hover:text-white',
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
