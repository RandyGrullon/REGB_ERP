'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '../utils'

/**
 * Barra superior — el patron estandar de una aplicacion de gestion.
 *
 * A la izquierda el producto y el selector de empresa; a la derecha el menu
 * de usuario. Sustituye al rail lateral de empresas y a la barra de usuario
 * del pie: dos cosas que venian de apps de chat y que en un ERP solo
 * ocupaban espacio.
 */

export interface Company {
  id: string
  name: string
  /** Etiqueta corta bajo el nombre: RNC, plan, lo que aplique. */
  hint?: string | undefined
}

export interface TopBarProps {
  productName: string
  companies: Company[]
  activeCompanyId: string
  onSelectCompany?: (id: string) => void
  user: { name: string; email?: string; role: string }
  onSignOut?: () => void
  /** Slot central: buscador, migas de pan, lo que la pagina necesite. */
  center?: React.ReactNode
  /** Slot derecho antes del menu de usuario. */
  actions?: React.ReactNode
  className?: string
}

export function TopBar({
  productName,
  companies,
  activeCompanyId,
  onSelectCompany,
  user,
  onSignOut,
  center,
  actions,
  className,
}: TopBarProps) {
  const activa = companies.find((c) => c.id === activeCompanyId)

  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center gap-3 px-3 md:px-4',
        'border-b border-[var(--color-border)] bg-[var(--color-surface-deep)]',
        className,
      )}
    >
      {/* Producto */}
      <span className="hidden shrink-0 text-sm font-bold tracking-tight text-[var(--color-text-primary)] sm:inline">
        {productName}
      </span>

      <span className="hidden h-5 w-px shrink-0 bg-[var(--color-border)] sm:block" aria-hidden />

      {/* Selector de empresa */}
      <Menu
        label={activa?.name ?? 'Empresa'}
        sublabel={activa?.hint}
        ariaLabel="Cambiar de empresa"
        className="min-w-0 max-w-[220px]"
      >
        {companies.map((c) => (
          <MenuItem
            key={c.id}
            active={c.id === activeCompanyId}
            onSelect={() => onSelectCompany?.(c.id)}
          >
            <span className="block truncate">{c.name}</span>
            {c.hint && (
              <span className="block truncate text-[11px] text-[var(--color-text-muted)]">
                {c.hint}
              </span>
            )}
          </MenuItem>
        ))}
      </Menu>

      <div className="min-w-0 flex-1">{center}</div>

      {actions}

      {/* Menu de usuario */}
      <Menu
        label={user.name}
        sublabel={user.role}
        ariaLabel="Menu de usuario"
        align="right"
        className="shrink-0"
      >
        <div className="border-b border-[var(--color-border)] px-3 py-2">
          <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
            {user.name}
          </p>
          {user.email && (
            <p className="truncate text-xs text-[var(--color-text-muted)]">{user.email}</p>
          )}
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{user.role}</p>
        </div>
        {onSignOut && <MenuItem onSelect={onSignOut}>Cerrar sesion</MenuItem>}
      </Menu>
    </header>
  )
}

/** Menu desplegable simple, sin dependencias. */
function Menu({
  label,
  sublabel,
  ariaLabel,
  align = 'left',
  className,
  children,
}: {
  label: string
  sublabel?: string | undefined
  ariaLabel: string
  align?: 'left' | 'right'
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-[var(--radius-md)] px-2',
          'text-left transition-colors duration-100',
          'hover:bg-[var(--color-surface-raised)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[var(--color-brand-bright)]',
          open && 'bg-[var(--color-surface-raised)]',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
            {label}
          </span>
          {sublabel && (
            <span className="block truncate text-[11px] leading-tight text-[var(--color-text-muted)]">
              {sublabel}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className={cn(
            'shrink-0 text-[10px] text-[var(--color-text-muted)] transition-transform duration-100',
            open && 'rotate-180',
          )}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-50 mt-1 min-w-[220px] overflow-hidden',
            'rounded-[var(--radius-md)] border border-[var(--color-border)]',
            'bg-[var(--color-surface-overlay)] shadow-[var(--shadow-md)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  active,
  onSelect,
  children,
}: {
  active?: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'block w-full px-3 py-2 text-left text-sm transition-colors duration-100',
        'focus-visible:outline-2 focus-visible:-outline-offset-2',
        'focus-visible:outline-[var(--color-brand-bright)]',
        active
          ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
      )}
    >
      {children}
    </button>
  )
}
