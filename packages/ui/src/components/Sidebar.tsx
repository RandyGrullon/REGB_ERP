'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { cn } from '../utils'
import { Icon } from './Icon'

/**
 * Navegacion lateral — 236px.
 *
 * ── Como se organiza ──────────────────────────────────────────────────
 *
 * Seccion (area de negocio) → modulo → pantallas del modulo.
 *
 * Antes era una lista plana de RUTAS: un cliente con 80 modulos tenia mas
 * de 150 enlaces seguidos bajo "Operacion", y encontrar Nomina era hacer
 * scroll. Ahora:
 *
 *  - Cada modulo es UNA fila. Su nombre lleva a su pantalla principal con
 *    un clic -el cajero sigue llegando a la caja con un clic-, y una
 *    flecha aparte despliega sus otras pantallas. El modulo donde estas se
 *    despliega solo.
 *  - Las secciones se pliegan. Con muchos modulos, arrancan plegadas salvo
 *    la tuya; con pocos, todo abierto. Lo que cada quien abre o cierra se
 *    recuerda en ese navegador.
 *  - Con muchos modulos aparece "Buscar en el menu": filtra modulos y
 *    pantallas por nombre, sin importar tildes.
 *
 * El elemento activo se marca con TRES señales a la vez —barra de acento a
 * la izquierda, fondo tenue e icono relleno— no solo con color (§11.7).
 *
 * IMPORTANTE: este componente NO decide que se ve. Recibe lo que el
 * module-registry ya resolvio a partir de `regb.tenant_modules` y el rol
 * del usuario, y la seccion la declara cada manifest (`navSection`). No
 * conoce ni un solo id de modulo (§2.2).
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
  /** Icono de la seccion, opcional. */
  icon?: string | undefined
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

/** Por encima de esto el menu arranca plegado y aparece el buscador. */
const MUCHOS_MODULOS = 20

const CLAVE_SECCIONES = 'regb-menu-secciones'
const CLAVE_MODULOS = 'regb-menu-modulos'

/** "Nómina" y "nomina" son lo mismo para quien busca con prisa. */
const plano = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Estado recordado. localStorage puede no existir o fallar (modo privado). */
function leer(clave: string): Record<string, boolean> {
  try {
    const crudo = window.localStorage.getItem(clave)
    return crudo ? (JSON.parse(crudo) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function guardar(clave: string, valor: Record<string, boolean>) {
  try {
    window.localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    // Sin almacenamiento, el menu funciona igual; solo no recuerda.
  }
}

export function Sidebar({ groups, activePath, onNavigate, footer, className }: SidebarProps) {
  const totalModulos = groups.reduce((n, g) => n + g.modules.length, 0)
  const muchos = totalModulos > MUCHOS_MODULOS

  const [busqueda, setBusqueda] = useState('')
  // Lo que el usuario abrio o cerro a mano. Se lee DESPUES de montar: el
  // primer render tiene que coincidir con el del servidor.
  const [secciones, setSecciones] = useState<Record<string, boolean>>({})
  const [modulos, setModulos] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setSecciones(leer(CLAVE_SECCIONES))
    setModulos(leer(CLAVE_MODULOS))
  }, [])

  const esActiva = (m: SidebarModule) => m.routes.some((r) => r.path === activePath)

  const seccionAbierta = (g: SidebarGroup) => {
    if (!g.title) return true
    if (g.modules.some(esActiva)) return true
    return secciones[g.key] ?? !muchos
  }
  const moduloAbierto = (m: SidebarModule) => modulos[m.moduleId] ?? esActiva(m)

  const alternarSeccion = (g: SidebarGroup) => {
    const siguiente = { ...secciones, [g.key]: !seccionAbierta(g) }
    setSecciones(siguiente)
    guardar(CLAVE_SECCIONES, siguiente)
  }
  const alternarModulo = (m: SidebarModule) => {
    const siguiente = { ...modulos, [m.moduleId]: !moduloAbierto(m) }
    setModulos(siguiente)
    guardar(CLAVE_MODULOS, siguiente)
  }

  // Filtro: un modulo entra si su nombre coincide (con todas sus pantallas)
  // o si alguna de sus pantallas coincide (solo esas).
  const q = plano(busqueda.trim())
  const visibles = useMemo(() => {
    if (!q) return groups
    return groups
      .map((g) => ({
        ...g,
        modules: g.modules
          .map((m) =>
            plano(m.label).includes(q)
              ? m
              : { ...m, routes: m.routes.filter((r) => plano(r.label).includes(q)) },
          )
          .filter((m) => m.routes.length > 0),
      }))
      .filter((g) => g.modules.length > 0)
  }, [groups, q])

  const navegar = (e: React.MouseEvent, path: string) => {
    if (onNavigate) {
      e.preventDefault()
      onNavigate(path)
    }
  }

  return (
    <div
      className={cn(
        'flex w-[236px] shrink-0 flex-col bg-[var(--color-surface-deep)]',
        'border-r border-[var(--color-border)]',
        className,
      )}
    >
      {muchos && (
        <div className="shrink-0 px-2 pt-3">
          <label className="relative flex items-center">
            <span className="sr-only">Buscar en el menú</span>
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-2.5 text-[var(--color-text-muted)]"
            />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setBusqueda('')
              }}
              placeholder="Buscar en el menú"
              className="h-8 w-full rounded-[var(--radius-full)] border border-[var(--color-border)] bg-[var(--color-surface-input)] pl-8 pr-3 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand-bright)]"
            />
          </label>
        </div>
      )}

      <nav aria-label="Navegación" className="flex-1 overflow-y-auto px-2 py-3">
        {groups.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs leading-relaxed text-[var(--color-text-muted)]">
            Tu administrador aún no te ha dado acceso a ningún módulo.
          </p>
        ) : visibles.length === 0 ? (
          <p role="status" className="px-2 py-6 text-center text-xs text-[var(--color-text-muted)]">
            Nada en el menú coincide con “{busqueda.trim()}”.
          </p>
        ) : (
          visibles.map((group) => (
            <Seccion
              key={group.key}
              group={group}
              // Mientras se busca, todo lo que coincide se ve desplegado.
              abierta={q ? true : seccionAbierta(group)}
              onAlternar={() => alternarSeccion(group)}
            >
              {group.modules.map((mod) => (
                <FilaModulo
                  key={mod.moduleId}
                  mod={mod}
                  activePath={activePath}
                  abierto={q ? true : moduloAbierto(mod)}
                  onAlternar={() => alternarModulo(mod)}
                  onNavegar={navegar}
                />
              ))}
            </Seccion>
          ))
        )}
      </nav>

      {footer && (
        <div className="shrink-0 border-t border-[var(--color-border)] px-2 py-2">{footer}</div>
      )}
    </div>
  )
}

function Seccion({
  group,
  abierta,
  onAlternar,
  children,
}: {
  group: SidebarGroup
  abierta: boolean
  onAlternar: () => void
  children: React.ReactNode
}) {
  const id = useId()
  const cuenta = group.modules.length

  return (
    <section className="mb-3 last:mb-0">
      {group.title && (
        <h2>
          <button
            type="button"
            onClick={onAlternar}
            aria-expanded={abierta}
            aria-controls={id}
            // Sin mayusculas: "INVENTARIO Y COMPRAS" no cabia en 236px y se
            // cortaba. Como en las barras laterales de Apple, titulo normal.
            className="group flex h-7 w-full items-center gap-1.5 rounded-[var(--radius-md)] px-3 text-left text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            <span className="flex-1 truncate">{group.title}</span>
            {!abierta && (
              <span className="tabular rounded-[var(--radius-full)] px-1.5 text-[11px] font-medium">
                {cuenta}
              </span>
            )}
            <Icon
              name="expand_more"
              size={16}
              className={cn(
                'shrink-0 transition-transform duration-150',
                abierta ? 'rotate-0' : '-rotate-90',
              )}
            />
          </button>
        </h2>
      )}
      <ul id={id} hidden={!abierta} className="mt-0.5 space-y-0.5">
        {children}
      </ul>
    </section>
  )
}

function FilaModulo({
  mod,
  activePath,
  abierto,
  onAlternar,
  onNavegar,
}: {
  mod: SidebarModule
  activePath: string
  abierto: boolean
  onAlternar: () => void
  onNavegar: (e: React.MouseEvent, path: string) => void
}) {
  const id = useId()
  const principal = mod.routes[0]!
  const variasPantallas = mod.routes.length > 1
  // Un modulo de una sola pantalla se llama como su pantalla ("Caja" no
  // "Punto de venta" cuando es lo unico que hay); uno de varias, por su
  // nombre, y sus pantallas cuelgan debajo.
  const etiqueta = variasPantallas ? mod.label : principal.label
  const activoAqui = mod.routes.some((r) => r.path === activePath)
  const principalActiva = principal.path === activePath
  const badgeTotal = mod.routes.reduce((n, r) => n + (r.badge ?? 0), 0)

  return (
    <li>
      <div className="group relative flex items-center">
        <a
          href={principal.path}
          aria-current={principalActiva ? 'page' : undefined}
          onClick={(e) => onNavegar(e, principal.path)}
          className={cn(
            'relative flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-lg)] pl-3 md:h-9',
            variasPantallas ? 'pr-8' : 'pr-2',
            'text-sm transition-colors duration-100',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
            activoAqui
              ? 'bg-[var(--color-brand-soft)] font-medium text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
          )}
        >
          {/* Barra de acento: la señal de "estas aqui" que no depende de
              distinguir colores. */}
          <span
            aria-hidden
            className={cn(
              'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity duration-100',
              activoAqui ? 'bg-[var(--color-brand-bright)] opacity-100' : 'opacity-0',
            )}
          />
          <Icon
            name={(variasPantallas ? mod.icon : principal.icon) ?? mod.icon ?? 'chevron_right'}
            size={18}
            filled={activoAqui}
            className={cn(
              'shrink-0 transition-colors duration-100',
              activoAqui
                ? 'text-[var(--color-brand-bright)]'
                : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]',
            )}
          />
          <span className="flex-1 truncate">{etiqueta}</span>

          {mod.isTrial && (
            <span
              title={`En prueba: ${mod.trialDaysLeft ?? 0} días restantes`}
              className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-brand-soft)] px-1.5 text-[10px] font-medium text-[var(--color-brand-bright)]"
            >
              <span className="sr-only">En prueba, quedan </span>
              {mod.trialDaysLeft ?? 0}d
            </span>
          )}
          {/* `degraded` = le falta un modulo RECOMENDADO (Inventario sin
              Ordenes de compra). No es una falla: pintarlo con un triangulo
              amarillo en el menu hacia creer al dueño que algo estaba roto.
              La sugerencia vive en el marketplace, en "Con que funciona". */}
          {badgeTotal > 0 && !abierto && (
            <span className="tabular shrink-0 rounded-[var(--radius-full)] bg-[var(--color-semantic-danger)] px-1.5 text-[10px] font-semibold leading-[18px] text-white">
              {badgeTotal > 99 ? '99+' : badgeTotal}
            </span>
          )}
        </a>

        {variasPantallas && (
          <button
            type="button"
            onClick={onAlternar}
            aria-expanded={abierto}
            aria-controls={id}
            aria-label={`${abierto ? 'Ocultar' : 'Ver'} pantallas de ${mod.label}`}
            className="absolute right-1 grid h-7 w-7 place-items-center rounded-[var(--radius-full)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand-bright)]"
          >
            <Icon
              name="expand_more"
              size={18}
              className={cn(
                'transition-transform duration-150',
                abierto ? 'rotate-0' : '-rotate-90',
              )}
            />
          </button>
        )}
      </div>

      {variasPantallas && (
        <ul id={id} hidden={!abierto} className="ml-[21px] mt-0.5 space-y-0.5 border-l border-[var(--color-border)] pl-2">
          {mod.routes.map((route) => {
            const activa = route.path === activePath
            return (
              <li key={route.path}>
                <a
                  href={route.path}
                  aria-current={activa ? 'page' : undefined}
                  onClick={(e) => onNavegar(e, route.path)}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-[var(--radius-md)] px-2 text-[13px] md:h-8',
                    'transition-colors duration-100',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
                    activa
                      ? 'font-semibold text-[var(--color-brand-bright)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
                  )}
                >
                  <span className="flex-1 truncate">{route.label}</span>
                  {route.badge ? (
                    <span className="tabular shrink-0 rounded-[var(--radius-full)] bg-[var(--color-semantic-danger)] px-1.5 text-[10px] font-semibold leading-[18px] text-white">
                      {route.badge > 99 ? '99+' : route.badge}
                    </span>
                  ) : null}
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
