'use client'

import { cn } from '../utils'
import { Icon } from './Icon'

/**
 * Navegacion lateral — 236px.
 *
 * Secciones planas con encabezado discreto, como cualquier panel de
 * administracion. Sin grupos colapsables en mayusculas ni barra de usuario
 * al pie: el usuario vive en la barra superior, que es donde la gente lo
 * busca.
 *
 * El elemento activo se marca con TRES señales a la vez —barra de acento a
 * la izquierda, fondo tenue e icono relleno— no solo con color. Quien no
 * distingue el teal del gris sigue viendo donde esta parado (§11.7).
 *
 * IMPORTANTE: este componente NO decide que se ve. Recibe lo que el
 * module-registry ya resolvio a partir de `regb.tenant_modules` y el rol
 * del usuario. No conoce ni un solo id de modulo (§2.2).
 */

export interface SidebarRoute {
  path: string
  label: string
  /** Icono Material Symbols propio de la ruta. Si falta, usa el del modulo. */
  icon?: string | undefined
  /** Contador a la derecha: pedidos pendientes, tickets sin leer. */
  badge?: number
}

export interface SidebarGroup {
  /** Identificador estable de la seccion. El titulo puede ir vacio. */
  key: string
  /** Encabezado visible. Vacio = seccion sin titulo (ej. "inicio"). */
  title: string
  modules: SidebarModule[]
}

export interface SidebarModule {
  moduleId: string
  label: string
  /** Icono Material Symbols del modulo, desde su manifest. */
  icon?: string | undefined
  category: string
  /** Seccion del menu declarada por el manifest. */
  navSection?: string | undefined
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
      <nav aria-label="Navegacion" className="flex-1 overflow-y-auto px-2 py-3">
        {groups.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs leading-relaxed text-[var(--color-text-muted)]">
            Tu administrador aun no te ha dado acceso a ningun modulo.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="mb-5 last:mb-0">
              {group.title && (
                <h2 className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                  {group.title}
                </h2>
              )}
              <ul className="space-y-0.5">
                {group.modules.flatMap((mod) =>
                  mod.routes.map((route) => {
                    const activa = route.path === activePath
                    return (
                      <li key={route.path}>
                        <a
                          href={route.path}
                          aria-current={activa ? 'page' : undefined}
                          onClick={(e) => {
                            if (onNavigate) {
                              e.preventDefault()
                              onNavigate(route.path)
                            }
                          }}
                          className={cn(
                            'group relative flex h-10 items-center gap-2.5 rounded-[var(--radius-lg)] pl-3 pr-2 md:h-9',
                            'text-sm transition-colors duration-100',
                            'focus-visible:outline-2 focus-visible:outline-offset-2',
                            'focus-visible:outline-[var(--color-brand-bright)]',
                            activa
                              ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-text-primary)]'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
                          )}
                        >
                          {/* Barra de acento: la señal de "estas aqui" que no
                              depende de distinguir colores. */}
                          <span
                            aria-hidden
                            className={cn(
                              'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity duration-100',
                              activa
                                ? 'bg-[var(--color-brand-bright)] opacity-100'
                                : 'bg-transparent opacity-0',
                            )}
                          />

                          <Icon
                            name={route.icon ?? mod.icon ?? 'chevron_right'}
                            size={18}
                            filled={activa}
                            className={cn(
                              'shrink-0 transition-colors duration-100',
                              activa
                                ? 'text-[var(--color-brand-bright)]'
                                : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]',
                            )}
                          />

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
                            <Icon
                              name="warning"
                              size={14}
                              className="shrink-0 text-[var(--color-semantic-text-warning)]"
                            />
                          )}

                          {route.badge ? (
                            <span className="tabular shrink-0 rounded-[var(--radius-full)] bg-[var(--color-semantic-danger)] px-1.5 text-[10px] font-semibold leading-[18px] text-white">
                              {route.badge > 99 ? '99+' : route.badge}
                            </span>
                          ) : null}
                        </a>
                      </li>
                    )
                  }),
                )}
              </ul>
            </section>
          ))
        )}
      </nav>

      {footer && (
        <div className="shrink-0 border-t border-[var(--color-border)] px-2 py-2">{footer}</div>
      )}
    </div>
  )
}
