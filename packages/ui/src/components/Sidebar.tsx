'use client'

import { useState } from 'react'
import { cn } from '../utils'
import { Badge } from './Badge'

/**
 * Sidebar de modulos — 240px.
 *
 * IMPORTANTE: este componente NO decide que se ve. Recibe lo que el
 * module-registry ya resolvio a partir de `regb.tenant_modules` y el rol
 * del usuario. No conoce ni un solo id de modulo (§2.2).
 */

export interface SidebarRoute {
  path: string
  label: string
  /** Contador a la derecha: pedidos pendientes, tickets sin leer. */
  badge?: number
}

export interface SidebarGroup {
  /** Titulo del grupo, en overline mayusculas. */
  title: string
  modules: SidebarModule[]
}

export interface SidebarModule {
  moduleId: string
  label: string
  category: string
  routes: SidebarRoute[]
  isTrial?: boolean
  trialDaysLeft?: number
  degraded?: boolean
}

export interface SidebarProps {
  tenantName: string
  groups: SidebarGroup[]
  activePath: string
  onNavigate?: (path: string) => void
  footer?: React.ReactNode
  className?: string
}

/** Color del punto segun la categoria comercial del modulo. */
const categoryDot: Record<string, string> = {
  core: 'var(--color-module-category-core)',
  standard: 'var(--color-module-category-standard)',
  advanced: 'var(--color-module-category-advanced)',
  vertical: 'var(--color-module-category-vertical)',
  enterprise: 'var(--color-module-category-enterprise)',
}

export function Sidebar({
  tenantName,
  groups,
  activePath,
  onNavigate,
  footer,
  className,
}: SidebarProps) {
  return (
    <div
      className={cn(
        'flex w-60 shrink-0 flex-col bg-[var(--color-surface-deep)]',
        'border-r border-[var(--color-border)]',
        className,
      )}
    >
      <header
        className={cn(
          'flex h-12 shrink-0 items-center px-4',
          'border-b border-[var(--color-border)] shadow-[var(--shadow-sm)]',
        )}
      >
        <h1 className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">
          {tenantName}
        </h1>
      </header>

      <nav aria-label="Modulos" className="flex-1 overflow-y-auto px-2 py-3">
        {groups.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-[var(--color-text-muted)]">
            Tu administrador aun no te ha dado acceso a ningun modulo.
          </p>
        ) : (
          groups.map((group) => (
            <SidebarGroupBlock
              key={group.title}
              group={group}
              activePath={activePath}
              onNavigate={onNavigate}
            />
          ))
        )}
      </nav>

      {footer && (
        <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-deepest)] p-2">
          {footer}
        </div>
      )}
    </div>
  )
}

function SidebarGroupBlock({
  group,
  activePath,
  onNavigate,
}: {
  group: SidebarGroup
  activePath: string
  // Explicitamente `| undefined` y no `?`: con exactOptionalPropertyTypes,
  // "puede faltar" y "puede valer undefined" no son lo mismo.
  onNavigate: ((path: string) => void) | undefined
}) {
  const [open, setOpen] = useState(true)
  const total = group.modules.reduce(
    (n, m) => n + m.routes.reduce((r, x) => r + (x.badge ?? 0), 0),
    0,
  )

  return (
    <section className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-1 px-2 py-1',
          'text-[11px] font-bold uppercase tracking-wide',
          'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-[var(--color-brand-bright)]',
        )}
      >
        <span
          aria-hidden
          className={cn('transition-transform duration-150', open ? 'rotate-90' : '')}
        >
          ›
        </span>
        <span className="flex-1 truncate text-left">{group.title}</span>
        {total > 0 && !open && (
          <span className="tabular rounded-full bg-[var(--color-semantic-danger)] px-1.5 text-[10px] font-bold text-white">
            {total}
          </span>
        )}
      </button>

      {open && (
        <ul className="mt-0.5 space-y-0.5">
          {group.modules.map((mod) => (
            <li key={mod.moduleId}>
              {mod.routes.map((route) => {
                const active = route.path === activePath
                return (
                  <a
                    key={route.path}
                    href={route.path}
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => {
                      if (onNavigate) {
                        e.preventDefault()
                        onNavigate(route.path)
                      }
                    }}
                    className={cn(
                      'group flex h-8 items-center gap-2 rounded-[var(--radius-md)] px-2',
                      'text-sm transition-colors duration-100',
                      'focus-visible:outline-2 focus-visible:outline-offset-2',
                      'focus-visible:outline-[var(--color-brand-bright)]',
                      active
                        ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
                    )}
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: categoryDot[mod.category] ?? 'var(--color-border)' }}
                    />
                    <span className="flex-1 truncate">{route.label}</span>

                    {mod.isTrial && (
                      <span
                        title={`Prueba: ${mod.trialDaysLeft ?? 0} dias restantes`}
                        className="shrink-0 rounded-full bg-[var(--color-brand-soft)] px-1.5 text-[10px] font-bold text-[var(--color-brand-bright)]"
                      >
                        {mod.trialDaysLeft ?? 0}d
                      </span>
                    )}

                    {mod.degraded && (
                      <span
                        title="Funciona con menos features: le falta un modulo recomendado"
                        className="shrink-0 text-[var(--color-semantic-text-warning)]"
                        aria-label="funcionalidad reducida"
                      >
                        !
                      </span>
                    )}

                    {route.badge ? (
                      <span className="tabular shrink-0 rounded-full bg-[var(--color-semantic-danger)] px-1.5 text-[10px] font-bold text-white">
                        {route.badge > 99 ? '99+' : route.badge}
                      </span>
                    ) : null}
                  </a>
                )
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Barra de usuario del pie del sidebar. */
export function UserBar({
  name,
  role,
  initials,
  status = 'online',
}: {
  name: string
  role: string
  initials: string
  status?: 'online' | 'idle' | 'dnd' | 'offline'
}) {
  const statusColor = {
    online: 'var(--color-semantic-success)',
    idle: 'var(--color-semantic-warning)',
    dnd: 'var(--color-semantic-danger)',
    offline: 'var(--color-semantic-neutral)',
  }[status]

  const statusLabel = {
    online: 'en linea',
    idle: 'ausente',
    dnd: 'no molestar',
    offline: 'desconectado',
  }[status]

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] p-1">
      <div className="relative shrink-0">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-brand)] text-xs font-bold text-white">
          {initials}
        </div>
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-[var(--color-surface-deepest)]"
          style={{ background: statusColor }}
          aria-label={statusLabel}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{name}</p>
        <p className="truncate text-[11px] text-[var(--color-text-muted)]">{role}</p>
      </div>
    </div>
  )
}

export { Badge }
