'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '../utils'
import { Icon } from './Icon'

/**
 * Barra superior — el patron estandar de una aplicacion de gestion.
 *
 * A la izquierda la marca y el selector de empresa; a la derecha el menu
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

/** Iniciales para el avatar: "Maria Rosario" → "MR". */
function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
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
        'flex h-14 shrink-0 items-center gap-2 px-3 md:gap-3 md:px-4',
        'border-b border-[var(--color-border)] bg-[var(--color-surface-deep)]',
        className,
      )}
    >
      {/* Marca: cuadro con la inicial + nombre. En movil solo el cuadro,
          que es lo que hace falta para saber en que producto estas. */}
      <span className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] bg-[var(--color-brand)] text-[13px] font-bold text-[var(--color-text-on-brand)]"
        >
          {productName.charAt(0)}
        </span>
        <span className="hidden text-sm font-bold tracking-tight text-[var(--color-text-primary)] sm:inline">
          {productName}
        </span>
      </span>

      <span className="hidden h-5 w-px shrink-0 bg-[var(--color-border)] sm:block" aria-hidden />

      {/* Selector de empresa */}
      <Menu
        label={activa?.name ?? 'Empresa'}
        sublabel={activa?.hint}
        ariaLabel="Cambiar de empresa"
        leading="apartment"
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
        avatar={iniciales(user.name)}
        className="shrink-0"
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-3">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-brand-soft)] text-xs font-semibold text-[var(--color-brand-bright)]"
          >
            {iniciales(user.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
              {user.name}
            </span>
            {user.email && (
              <span className="block truncate text-xs text-[var(--color-text-muted)]">
                {user.email}
              </span>
            )}
            <span className="block text-xs text-[var(--color-text-secondary)]">{user.role}</span>
          </span>
        </div>
        {onSignOut && (
          <MenuItem onSelect={onSignOut} icon="logout">
            Cerrar sesion
          </MenuItem>
        )}
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
  leading,
  avatar,
  className,
  children,
}: {
  label: string
  sublabel?: string | undefined
  ariaLabel: string
  align?: 'left' | 'right'
  /** Icono Material Symbols a la izquierda del texto. */
  leading?: string
  /** Iniciales en circulo, en vez de icono. Para el menu de usuario. */
  avatar?: string
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
          'flex h-10 w-full items-center gap-2 rounded-[var(--radius-lg)] px-2',
          'text-left transition-colors duration-100',
          'hover:bg-[var(--color-surface-raised)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[var(--color-brand-bright)]',
          open && 'bg-[var(--color-surface-raised)]',
        )}
      >
        {avatar ? (
          <span
            aria-hidden
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-brand-soft)] text-[11px] font-semibold text-[var(--color-brand-bright)]"
          >
            {avatar}
          </span>
        ) : leading ? (
          <Icon name={leading} size={18} className="shrink-0 text-[var(--color-text-muted)]" />
        ) : null}

        <span className="hidden min-w-0 flex-1 md:block">
          <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
            {label}
          </span>
          {sublabel && (
            <span className="block truncate text-[11px] leading-tight text-[var(--color-text-muted)]">
              {sublabel}
            </span>
          )}
        </span>

        <Icon
          name="expand_more"
          size={16}
          className={cn(
            'shrink-0 text-[var(--color-text-muted)] transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-50 mt-1.5 min-w-[240px] overflow-hidden',
            'rounded-[var(--radius-lg)] border border-[var(--color-border)]',
            'bg-[var(--color-surface-overlay)] shadow-[var(--shadow-lg)]',
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
  icon,
  children,
}: {
  active?: boolean
  onSelect: () => void
  icon?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors duration-100',
        'focus-visible:outline-2 focus-visible:-outline-offset-2',
        'focus-visible:outline-[var(--color-brand-bright)]',
        active
          ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
      )}
    >
      {icon && <Icon name={icon} size={18} className="shrink-0 text-[var(--color-text-muted)]" />}
      {active && (
        <Icon name="check" size={18} className="shrink-0 text-[var(--color-brand-bright)]" />
      )}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}
