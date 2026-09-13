'use client'

import { useState } from 'react'
import { dunningBanner } from '@regb/billing'
import { GlobalSearch, type SearchEntry } from './GlobalSearch'
import { Aviso } from './Aviso'
import { Navegacion } from './Navegacion'
import type { Aviso as AvisoDato } from '@/lib/aviso-comun'
import { GuiaFlotante, type PasoGuia } from '@/components/GuiaFlotante'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Icon,
  Sidebar,
  StatCard,
  TopBar,
  type SidebarGroup,
  type SidebarModule,
} from '@regb/ui'

/**
 * Shell de REGB — barra superior + navegacion lateral + contenido.
 *
 * El patron estandar de una aplicacion de gestion. La empresa y el usuario
 * viven arriba, que es donde la gente los busca; la navegacion a la
 * izquierda; el trabajo en el centro.
 *
 * Todo lo que pinta viene del bootstrap del servidor. El shell no sabe que
 * modulos existen; recibe una lista ya resuelta (§2.2).
 */

interface ShellData {
  tenant: { id: string; name: string; tier: string; status: string }
  user: { id: string; name: string; initials: string; email?: string }
  roleName: string
  sidebar: SidebarModule[]
  activeModules: string[]
  widgets: string[]
  unavailable: Array<{ moduleId: string; reason: string }>
  routeCount: number
  /** Avisos sin leer, para la campana. */
  unread?: number
  /** Indice de Ctrl+K, ya filtrado por rol en el servidor. */
  search?: SearchEntry[]
}

export interface ShellProps {
  tenants: { id: string; slug: string; name: string; initials: string; tier: string }[]
  activeSlug: string
  roles: string[]
  activeRole: string
  activePlatform: 'web' | 'desktop' | 'mobile'
  /** Sin Supabase configurado: se puede cambiar de tenant y rol por URL. */
  demoMode: boolean
  /** Usuario del proveedor: ve el enlace a REGB Control (§7). */
  isProvider?: boolean
  /** Sesion de impersonacion activa: banner permanente (§7.4). */
  impersonating?: boolean
  /** Ruta actual, para resaltar en el sidebar. */
  activePath?: string
  /** Resultado de la ultima accion, para confirmarlo o explicar el fallo. */
  aviso?: AvisoDato | null
  /**
   * Paso del tour a pintar encima de esta pantalla, si el usuario llego
   * aqui desde el tutorial. Lo calcula `modulePage`, no la pagina.
   */
  guia?: PasoGuia | undefined
  /** Contenido de la pagina. Sin children, pinta el resumen del registry. */
  children?: React.ReactNode
  data: ShellData
}

/**
 * Titulo de cada seccion del sidebar.
 *
 * Las secciones son de USO, no de precio: cada modulo declara la suya en su
 * manifest (`navSection`) y el registry ya las devuelve ordenadas. Antes se
 * agrupaba por categoria comercial y eso dejaba Auditoria y Respaldos por
 * encima del punto de venta.
 *
 * `inicio` va sin encabezado a proposito: son una o dos entradas sueltas y
 * un titulo encima solo mete ruido.
 */
const GROUP_TITLES: Record<string, string> = {
  inicio: '',
  operacion: 'Operacion',
  administracion: 'Administracion',
  datos: 'Datos',
  ayuda: 'Ayuda',
}

const TIER_LABEL: Record<string, string> = {
  pyme: 'PYME',
  mediano: 'MEDIANO',
  grande: 'GRANDE',
}

export function Shell({
  tenants,
  activeSlug,
  roles,
  activeRole,
  activePlatform,
  demoMode,
  isProvider = false,
  impersonating = false,
  activePath = '/',
  aviso = null,
  guia,
  children,
  data,
}: ShellProps) {
  const [menuAbierto, setMenuAbierto] = useState(false)

  // Mora (§6.6): amarillo con factura pendiente, rojo en solo lectura.
  const mora = dunningBanner(data.tenant.status)

  // Agrupa por seccion conservando el orden que ya trae el registry.
  const groups: SidebarGroup[] = []
  for (const mod of data.sidebar) {
    const seccion = mod.navSection ?? 'operacion'
    const title = GROUP_TITLES[seccion] ?? seccion
    let g = groups.find((x) => x.key === seccion)
    if (!g) {
      g = { key: seccion, title, modules: [] }
      groups.push(g)
    }
    g.modules.push(mod)
  }

  const go = (patch: Record<string, string>) => {
    const url = new URL(window.location.href)
    for (const [k, v] of Object.entries(patch)) url.searchParams.set(k, v)
    window.location.href = url.toString()
  }

  const qs = demoMode ? `?tenant=${activeSlug}&rol=${encodeURIComponent(activeRole)}` : ''

  const pieCls =
    'flex h-10 items-center gap-2.5 rounded-[var(--radius-lg)] px-3 text-sm transition-colors duration-100 hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] md:h-9'

  const enlacesPie = (
    <div className="space-y-0.5">
      <a href={`/marketplace${qs}`} className={cn(pieCls, 'text-[var(--color-text-secondary)]')}>
        <Icon name="extension" size={18} className="shrink-0 text-[var(--color-text-muted)]" />
        Marketplace
      </a>
      <a href={`/roles${qs}`} className={cn(pieCls, 'text-[var(--color-text-secondary)]')}>
        <Icon
          name="admin_panel_settings"
          size={18}
          className="shrink-0 text-[var(--color-text-muted)]"
        />
        Roles y permisos
      </a>
      {/* Solo el proveedor: su panel por encima de los tenants (§7). En demo se muestra porque toda la app es vitrina. */}
      {(isProvider || demoMode) && (
        <a
          href="/control"
          className={cn(
            pieCls,
            'text-[var(--color-accent-plum-bright,var(--color-text-secondary))]',
          )}
        >
          <Icon name="shield_person" size={18} className="shrink-0 opacity-70" />
          REGB Control
        </a>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <Aviso aviso={aviso} />
      {guia !== undefined && <GuiaFlotante guia={guia} />}
      <TopBar
        productName="REGB"
        companies={tenants.map((t) => ({
          id: t.slug,
          name: t.name,
          // El tier de CADA empresa, no el de la activa.
          hint: TIER_LABEL[t.tier] ?? t.tier,
        }))}
        activeCompanyId={activeSlug}
        onSelectCompany={(slug) => go({ tenant: slug, rol: 'Owner' })}
        user={{
          name: data.user.name,
          ...(data.user.email ? { email: data.user.email } : {}),
          role: data.roleName,
        }}
        {...(demoMode ? {} : { onSignOut: () => document.forms.namedItem('salir')?.submit() })}
        center={
          <div className="flex items-center gap-2">
            <Navegacion />
            {data.search && <GlobalSearch index={data.search} qs={qs} />}
            {/* Controles de la demostracion */}
            {demoMode && (
              <>
                <label className="hidden items-center gap-1.5 text-xs text-[var(--color-text-muted)] sm:flex">
                  Rol
                  <select
                    value={activeRole}
                    onChange={(e) => go({ rol: e.target.value })}
                    className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="hidden items-center gap-1.5 text-xs text-[var(--color-text-muted)] lg:flex">
                  Plataforma
                  <select
                    value={activePlatform}
                    onChange={(e) => go({ plataforma: e.target.value })}
                    className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="web">Web</option>
                    <option value="desktop">Escritorio</option>
                    <option value="mobile">Movil</option>
                  </select>
                </label>
              </>
            )}
          </div>
        }
        actions={
          <>
            <a
              href={`/notificaciones${qs}`}
              aria-label={`Notificaciones${data.unread ? `: ${data.unread} sin leer` : ''}`}
              className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="notifications" size={20} filled={(data.unread ?? 0) > 0} />
              {(data.unread ?? 0) > 0 && (
                <span className="tabular absolute right-1 top-1 min-w-4 rounded-[var(--radius-full)] bg-[var(--color-semantic-danger)] px-1 text-center text-[10px] font-bold text-white">
                  {data.unread}
                </span>
              )}
            </a>
            <button
              type="button"
              aria-label="Abrir navegacion"
              aria-expanded={menuAbierto}
              onClick={() => setMenuAbierto((v) => !v)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] md:hidden"
            >
              <Icon name={menuAbierto ? 'close' : 'menu'} size={22} />
            </button>
          </>
        }
      />

      {!demoMode && (
        <form id="salir" name="salir" action="/auth/salir" method="post" className="hidden" />
      )}

      {impersonating && (
        <div
          role="alert"
          className="flex h-9 shrink-0 items-center justify-center gap-2 bg-[var(--color-accent-plum)] px-4 text-xs font-medium text-white"
        >
          <Icon name="visibility" size={16} /> Estas viendo los datos de {data.tenant.name} como
          proveedor. La sesion expira sola a los 60 minutos y quedo registrada en ambas bitacoras.
          <a href="/control" className="underline">
            Terminar
          </a>
        </div>
      )}

      {mora && (
        <div
          role="alert"
          className="flex min-h-9 shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium"
          style={{
            // Mismo par fondo-suave/texto-semantico que Badge: contraste AA
            // verificado por los tests de @regb/config.
            background: `color-mix(in srgb, var(--color-semantic-${mora.tone}) 18%, var(--color-surface-deep))`,
            color: `var(--color-semantic-text-${mora.tone})`,
          }}
        >
          <Icon name={mora.tone === 'danger' ? 'lock' : 'warning'} size={16} filled />
          {mora.message}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar
          groups={groups}
          activePath={activePath}
          onNavigate={(p) => {
            window.location.href = p + qs
          }}
          footer={enlacesPie}
          className="hidden md:flex"
        />

        {/* Navegacion movil: panel deslizante desde la izquierda */}
        {menuAbierto && (
          <div className="fixed inset-0 top-14 z-40 flex md:hidden">
            <button
              type="button"
              aria-label="Cerrar navegacion"
              onClick={() => setMenuAbierto(false)}
              className="absolute inset-0 bg-black/60"
            />
            <div className="relative">
              <Sidebar
                groups={groups}
                activePath={activePath}
                onNavigate={(p) => {
                  setMenuAbierto(false)
                  window.location.href = p + qs
                }}
                footer={enlacesPie}
              />
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children ? (
            children
          ) : data.sidebar.length === 0 ? (
            <EmptyState
              icon="lock"
              title="Aqui no hay nada para ti todavia"
              description={`El rol "${data.roleName}" no tiene ningun modulo visible en ${activePlatform}. Cambia de rol arriba para verlo desde otra silla.`}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                  Buenos dias, {data.user.name.split(' ')[0]}
                </h1>
                <Badge tone={data.tenant.status === 'active' ? 'success' : 'warning'}>
                  {TIER_LABEL[data.tenant.tier] ?? data.tenant.tier}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                Estas viendo REGB como <strong>{data.roleName}</strong> en{' '}
                <strong>{activePlatform}</strong>.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Modulos activos"
                  value={String(data.activeModules.length)}
                  hint="licenciados y encendidos"
                />
                <StatCard
                  label="Visibles para ti"
                  value={String(data.sidebar.length)}
                  hint="segun tu rol"
                />
                <StatCard
                  label="Rutas registradas"
                  value={String(data.routeCount)}
                  hint="con permiso en servidor"
                />
                <StatCard
                  label="No disponibles"
                  value={String(data.unavailable.length)}
                  hint="y por que"
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Que resolvio el registry</CardTitle>
                  </CardHeader>
                  <CardBody className="space-y-2">
                    {data.sidebar.map((m) => (
                      <div
                        key={m.moduleId}
                        className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] px-3 py-2"
                      >
                        <span className="flex-1 text-sm text-[var(--color-text-primary)]">
                          {m.label}
                        </span>
                        {m.isTrial && <Badge tone="brand">prueba · {m.trialDaysLeft}d</Badge>}
                        {m.degraded && <Badge tone="warning">degradado</Badge>}
                        <Badge tone="neutral" dot={false}>
                          {m.routes.length} rutas
                        </Badge>
                      </div>
                    ))}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Que NO se cargo, y por que</CardTitle>
                  </CardHeader>
                  <CardBody>
                    {data.unavailable.length === 0 ? (
                      <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">
                        Todo lo licenciado pudo cargarse.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {data.unavailable.map((u) => (
                          <li
                            key={u.moduleId}
                            className="rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] px-3 py-2"
                          >
                            <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--color-semantic-text-warning)]">
                              {u.moduleId}
                            </p>
                            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                              {u.reason}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <a
                  href={`/marketplace${qs}`}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-[var(--radius-md)] px-4',
                    'bg-[var(--color-brand)] text-sm font-medium text-[var(--color-text-on-brand)]',
                    'transition-colors duration-100 hover:bg-[var(--color-brand-hover)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2',
                    'focus-visible:outline-[var(--color-brand-bright)]',
                  )}
                >
                  Ver el marketplace
                </a>
                <a
                  href={`/roles${qs}`}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-[var(--radius-md)] px-4',
                    'bg-[var(--color-surface-raised)] text-sm font-medium text-[var(--color-text-primary)]',
                    'transition-colors duration-100 hover:bg-[var(--color-surface-overlay)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2',
                    'focus-visible:outline-[var(--color-brand-bright)]',
                  )}
                >
                  Roles y permisos
                </a>
              </div>

              <p className="mt-6 text-xs text-[var(--color-text-muted)]">
                Nada de esto esta cableado en el codigo: sale de{' '}
                <code className="font-[family-name:var(--font-mono)]">regb.tenant_modules</code> y
                del rol, resuelto por{' '}
                <code className="font-[family-name:var(--font-mono)]">@regb/module-registry</code>.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
