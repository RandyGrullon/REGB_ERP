'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  ServerRail,
  Sidebar,
  StatCard,
  UserBar,
  type SidebarGroup,
  type SidebarModule,
} from '@regb/ui'

/**
 * Shell de REGB — el layout de 4 columnas de §12.1.
 *
 * rail 72px · sidebar 240px · contenido flex · miembros 240px
 *
 * Todo lo que pinta viene del bootstrap del servidor. El shell no sabe que
 * modulos existen; recibe una lista ya resuelta.
 */

interface ShellData {
  tenant: { id: string; name: string; tier: string; status: string }
  user: { id: string; name: string; initials: string }
  roleName: string
  sidebar: SidebarModule[]
  activeModules: string[]
  widgets: string[]
  unavailable: Array<{ moduleId: string; reason: string }>
  routeCount: number
}

export interface ShellProps {
  tenants: { id: string; slug: string; name: string; initials: string }[]
  activeSlug: string
  roles: string[]
  activeRole: string
  activePlatform: 'web' | 'desktop' | 'mobile'
  data: ShellData
}

/** Titulo del grupo del sidebar segun la categoria comercial. */
const GROUP_TITLES: Record<string, string> = {
  core: 'Plataforma',
  standard: 'Operacion',
  advanced: 'Avanzado',
  vertical: 'Tu industria',
  enterprise: 'Enterprise',
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
  data,
}: ShellProps) {
  const [activePath, setActivePath] = useState('/')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Agrupa por categoria conservando el orden que ya trae el registry.
  const groups: SidebarGroup[] = []
  for (const mod of data.sidebar) {
    const title = GROUP_TITLES[mod.category] ?? mod.category
    let g = groups.find((x) => x.title === title)
    if (!g) {
      g = { title, modules: [] }
      groups.push(g)
    }
    g.modules.push(mod)
  }

  const activeTenant = tenants.find((t) => t.slug === activeSlug)
  const go = (patch: Record<string, string>) => {
    const url = new URL(window.location.href)
    for (const [k, v] of Object.entries(patch)) url.searchParams.set(k, v)
    window.location.href = url.toString()
  }

  return (
    <div className="flex h-full">
      {/* ── Rail y sidebar: columnas fijas desde `md` ──────────────────
          En <768px se esconden y viven dentro del drawer (§13.2). */}
      <ServerRail
        items={tenants.map((t) => ({ id: t.slug, name: t.name, initials: t.initials }))}
        activeId={activeSlug}
        onSelect={(slug) => go({ tenant: slug, rol: 'Owner' })}
        className="hidden md:flex"
      />

      <Sidebar
        tenantName={data.tenant.name}
        groups={groups}
        activePath={activePath}
        onNavigate={setActivePath}
        className="hidden md:flex"
        footer={
          <UserBar
            name={data.user.name}
            role={data.roleName}
            initials={data.user.initials}
            status="online"
          />
        }
      />

      {/* ── Drawer movil ───────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Cerrar menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/70"
          />
          <div className="relative flex">
            <ServerRail
              items={tenants.map((t) => ({ id: t.slug, name: t.name, initials: t.initials }))}
              activeId={activeSlug}
              onSelect={(slug) => go({ tenant: slug, rol: 'Owner' })}
            />
            <Sidebar
              tenantName={data.tenant.name}
              groups={groups}
              activePath={activePath}
              onNavigate={(p) => {
                setActivePath(p)
                setDrawerOpen(false)
              }}
              footer={
                <UserBar
                  name={data.user.name}
                  role={data.roleName}
                  initials={data.user.initials}
                  status="online"
                />
              }
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4">
          <button
            type="button"
            aria-label="Abrir menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="-ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] md:hidden"
          >
            <span aria-hidden className="text-lg">
              ☰
            </span>
          </button>
          <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
            {activePath === '/' ? 'Inicio' : activePath}
          </span>
          <Badge tone={data.tenant.status === 'active' ? 'success' : 'warning'}>
            {TIER_LABEL[data.tenant.tier] ?? data.tenant.tier}
          </Badge>
          <div className="flex-1" />

          {/* Controles de la demo: cambiar de rol y de plataforma en vivo.
              En movil no caben junto al titulo: se ocultan. */}
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
        </header>

        <main className="flex-1 overflow-y-auto p-4 pb-20 md:p-6 md:pb-6">
          {data.sidebar.length === 0 ? (
            <EmptyState
              icon="🔒"
              title="Aqui no hay nada para ti todavia"
              description={`El rol "${data.roleName}" no tiene ningun modulo visible en ${activePlatform}. Cambia de rol arriba para verlo desde otra silla.`}
            />
          ) : (
            <>
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
                Buenos dias, {data.user.name.split(' ')[0]}
              </h2>
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

      <aside className="hidden w-60 shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface-deep)] p-3 xl:flex">
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          En linea — 1
        </h2>
        <UserBar
          name={data.user.name}
          role={data.roleName}
          initials={data.user.initials}
          status="online"
        />
        <div className="mt-auto">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Empresa
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">{activeTenant?.name}</p>
          <Button variant="secondary" size="sm" className="mt-3 w-full">
            🧩 Marketplace
          </Button>
        </div>
      </aside>

      {/* ── Nav inferior: 5 elementos, disenada para el pulgar (§13.3) ── */}
      <nav
        aria-label="Navegacion principal"
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-[var(--color-border)] bg-[var(--color-surface-deep)] md:hidden"
      >
        {bottomNav(data.sidebar).map((item) => {
          const active = item.path === activePath
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => item.path && setActivePath(item.path)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5',
                'focus-visible:outline-2 focus-visible:-outline-offset-2',
                'focus-visible:outline-[var(--color-brand-bright)]',
                active ? 'text-[var(--color-brand-bright)]' : 'text-[var(--color-text-muted)]',
              )}
            >
              <span aria-hidden className="text-lg leading-none">
                {item.icon}
              </span>
              <span className="text-[10px] leading-none">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

/**
 * Los 5 elementos de la nav inferior.
 *
 * El del medio es la accion rapida. Los dos de los lados salen de los
 * modulos que el usuario tiene de verdad: si no tiene POS, no ve "Caja".
 */
function bottomNav(
  modules: SidebarModule[],
): { key: string; icon: string; label: string; path: string | undefined }[] {
  const principales = modules.slice(0, 2)
  return [
    { key: 'home', icon: '🏠', label: 'Inicio', path: '/' },
    ...principales.map((m) => ({
      key: m.moduleId,
      icon: '📦',
      label: m.label.split(' ')[0] ?? m.label,
      path: m.routes[0]?.path,
    })),
    { key: 'add', icon: '➕', label: 'Nuevo', path: undefined },
    { key: 'me', icon: '👤', label: 'Perfil', path: undefined },
  ].slice(0, 5)
}
