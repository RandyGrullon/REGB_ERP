'use client'

import { cn } from '../utils'

/**
 * Navegacion lateral — 236px.
 *
 * Secciones planas con encabezado discreto, como cualquier panel de
 * administracion. Sin grupos colapsables en mayusculas ni barra de usuario
 * al pie: el usuario vive en la barra superior, que es donde la gente lo
 * busca.
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
  groups: SidebarGroup[]
  activePath: string
  onNavigate?: (path: string) => void
  /** Enlaces fijos al pie: configuracion, ayuda, marketplace. */
  footer?: React.ReactNode
  className?: string
}

export function Sidebar({ groups, activePath, onNavigate, footer, className }: SidebarProps) {
  return (
    <div
      className={cn(
        'flex w-[236px] shrink-0 flex-col bg-[var(--color-surface-deep)]',
        'border-r border-[var(--color-border)]',
        className,
      )}
    >
      <nav aria-label="Navegacion" className="flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-[var(--color-text-muted)]">
            Tu administrador aun no te ha dado acceso a ningun modulo.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.title} className="mb-4">
              <h2 className="px-2 pb-1 text-xs font-medium text-[var(--color-text-muted)]">
                {group.title}
              </h2>
              <ul>
                {group.modules.flatMap((mod) =>
                  mod.routes.map((route) => (
                    <li key={route.path}>
                      <a
                        href={route.path}
                        aria-current={route.path === activePath ? 'page' : undefined}
                        onClick={(e) => {
                          if (onNavigate) {
                            e.preventDefault()
                            onNavigate(route.path)
                          }
                        }}
                        className={cn(
                          'flex h-9 items-center gap-2 rounded-[var(--radius-md)] px-2',
                          'text-sm transition-colors duration-100',
                          'focus-visible:outline-2 focus-visible:outline-offset-2',
                          'focus-visible:outline-[var(--color-brand-bright)]',
                          route.path === activePath
                            ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-text-primary)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
                        )}
                      >
                        <span className="flex-1 truncate">{route.label}</span>

                        {mod.isTrial && (
                          <span
                            title={`En prueba: ${mod.trialDaysLeft ?? 0} dias restantes`}
                            className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-brand-soft)] px-1.5 text-[10px] font-medium text-[var(--color-brand-bright)]"
                          >
                            {mod.trialDaysLeft ?? 0}d
                          </span>
                        )}

                        {mod.degraded && (
                          <span
                            title="Funciona con menos features: le falta un modulo recomendado"
                            className="shrink-0 text-xs text-[var(--color-semantic-text-warning)]"
                            aria-label="funcionalidad reducida"
                          >
                            !
                          </span>
                        )}

                        {route.badge ? (
                          <span className="tabular shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-semantic-danger)] px-1.5 text-[10px] font-medium text-white">
                            {route.badge > 99 ? '99+' : route.badge}
                          </span>
                        ) : null}
                      </a>
                    </li>
                  )),
                )}
              </ul>
            </section>
          ))
        )}
      </nav>

      {footer && <div className="shrink-0 border-t border-[var(--color-border)] p-2">{footer}</div>}
    </div>
  )
}
