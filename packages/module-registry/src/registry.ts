/**
 * ═══════════════════════════════════════════════════════════════════════
 *  El registry
 *
 *  Recibe (a) los modulos licenciados del tenant, que salen de
 *  regb.tenant_modules, y (b) el rol del usuario. Devuelve las rutas y el
 *  sidebar que corresponden.
 *
 *  EL CORE NO CONOCE NINGUN MODULO. Aqui no hay ni un `if (moduleId === ...)`.
 *  Si aparece uno, `pnpm audit:registry` falla el build (§2.2).
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { ModuleStatus } from '@regb/core'
import { moduleVisible, type EvaluationContext } from '@regb/permissions'
import type { ModuleManifest, ModuleRoute } from './manifest.js'

/** Una fila de regb.tenant_modules. */
export interface TenantModule {
  moduleId: string
  status: ModuleStatus
  enabled: boolean
  trialEndsAt?: string | null
}

export interface SidebarEntry {
  moduleId: string
  label: string
  icon: string
  category: string
  /** Seccion del menu lateral, desde el manifest. */
  navSection: string
  navOrder: number
  routes: ModuleRoute[]
  /** El modulo corre en prueba: la UI lo marca. */
  isTrial: boolean
  trialDaysLeft?: number
  /** Le falta un `recommends`: funciona con menos features. */
  degraded: boolean
  missingOptional: string[]
}

export interface HydrationResult {
  sidebar: SidebarEntry[]
  /** path → permiso necesario. Lo consume el guard de rutas del servidor. */
  routePermissions: Map<string, string>
  /**
   * Modulos que pueden RENDERIZAR: licenciados, con manifest en este bundle
   * y compatibles con la plataforma. Es la frontera de presentacion.
   *
   * Para comprobar PERMISOS usa `licensedModules`. Un modulo licenciado
   * cuyo manifest aun no existe sigue siendo del cliente: negarle permisos
   * por eso convierte un hueco de implementacion en un 403 inexplicable.
   */
  activeModules: Set<string>
  /**
   * Modulos licenciados y encendidos, tenga o no manifest.
   *
   * Es la MISMA frontera que `rls.module_active()` en SQL, y por tanto la
   * que debe alimentar al evaluador de permisos.
   */
  licensedModules: Set<string>
  widgets: string[]
  /** Modulos licenciados que NO pudieron cargar, y por que. */
  unavailable: Array<{ moduleId: string; reason: string }>
}

/** Un modulo cuenta como activo solo si esta licenciado Y encendido. */
const isLive = (tm: TenantModule): boolean =>
  (tm.status === 'active' || tm.status === 'trial') && tm.enabled

export interface HydrateOptions {
  /** Filas de regb.tenant_modules del cliente. */
  tenantModules: TenantModule[]
  /** Manifests disponibles, por id. */
  manifests: Map<string, ModuleManifest>
  /** Rol y usuario, para decidir que se ve. */
  ctx: Omit<EvaluationContext, 'activeModules'>
  /** Plataforma donde corre. Un modulo puede no soportarla. */
  platform: 'web' | 'desktop' | 'mobile'
  /** Fecha de referencia, para los dias de prueba. Inyectable para tests. */
  now?: Date
}

/**
 * Construye el sidebar y las rutas del usuario actual.
 *
 * Es puro y sincrono: recibe datos, devuelve datos. La carga real de los
 * componentes (`import()`) la hace el shell despues, con esta lista.
 */
export function hydrate(opts: HydrateOptions): HydrationResult {
  const { tenantModules, manifests, ctx, platform, now = new Date() } = opts

  const unavailable: HydrationResult['unavailable'] = []

  // ── 1. Que esta licenciado y encendido ───────────────────────────────
  const licensed = new Set<string>()
  for (const tm of tenantModules) {
    if (isLive(tm)) licensed.add(tm.moduleId)
  }

  // ── 2. Descartar lo que no puede correr ──────────────────────────────
  const runnable = new Set<string>()
  for (const id of licensed) {
    const manifest = manifests.get(id)

    if (!manifest) {
      unavailable.push({ moduleId: id, reason: 'El manifest no esta disponible en este bundle.' })
      continue
    }

    if (!manifest.platforms[platform]) {
      unavailable.push({ moduleId: id, reason: `No soporta la plataforma "${platform}".` })
      continue
    }

    const faltantes = manifest.requires.filter((dep) => !licensed.has(dep))
    if (faltantes.length > 0) {
      unavailable.push({
        moduleId: id,
        reason: `Le faltan dependencias obligatorias: ${faltantes.join(', ')}.`,
      })
      continue
    }

    const choque = manifest.conflicts.find((c) => licensed.has(c))
    if (choque) {
      unavailable.push({ moduleId: id, reason: `Entra en conflicto con "${choque}".` })
      continue
    }

    runnable.add(id)
  }

  // ── 3. El contexto de permisos ya conoce lo que corre ────────────────
  const evalCtx: EvaluationContext = { ...ctx, activeModules: runnable }

  // ── 4. Sidebar y rutas ───────────────────────────────────────────────
  const sidebar: SidebarEntry[] = []
  const routePermissions = new Map<string, string>()
  const widgets: string[] = []

  for (const id of runnable) {
    const manifest = manifests.get(id)
    if (!manifest) continue

    // Toda ruta se registra, aunque el usuario no la vea: el guard del
    // servidor necesita saber que permiso exige para devolver 403.
    for (const route of manifest.routes) {
      routePermissions.set(route.path, route.perm)
    }

    if (!moduleVisible(id, evalCtx)) continue

    // Del sidebar solo cuelga lo que el rol puede abrir.
    const visibles = manifest.routes.filter((r) => !r.hidden && hasPermission(r.perm, evalCtx))
    if (visibles.length === 0) continue

    const tm = tenantModules.find((t) => t.moduleId === id)
    const missingOptional = manifest.recommends.filter((r) => !runnable.has(r))

    sidebar.push({
      moduleId: id,
      label: manifest.name,
      icon: manifest.icon,
      category: manifest.category,
      navSection: manifest.navSection,
      navOrder: manifest.navOrder,
      routes: visibles,
      isTrial: tm?.status === 'trial',
      ...(tm?.trialEndsAt ? { trialDaysLeft: daysUntil(tm.trialEndsAt, now) } : {}),
      degraded: missingOptional.length > 0,
      missingOptional,
    })

    widgets.push(...manifest.dashboardWidgets)
  }

  /**
   * Orden del menu: por seccion de USO, no por categoria comercial.
   *
   * La categoria (core/standard/...) dice cuanto cuesta el modulo. Ordenar
   * el menu con ella deja Auditoria y Respaldos por encima del punto de
   * venta, que es lo que el cajero abre doscientas veces al dia.
   *
   * Cada modulo declara su seccion y su orden en el manifest, asi que esto
   * sigue sin conocer ni un solo id de modulo (§2.2).
   */
  const ORDEN_SECCION = ['inicio', 'operacion', 'administracion', 'datos', 'ayuda']
  sidebar.sort((a, b) => {
    const sa = ORDEN_SECCION.indexOf(a.navSection)
    const sb = ORDEN_SECCION.indexOf(b.navSection)
    if (sa !== sb) return sa - sb
    if (a.navOrder !== b.navOrder) return a.navOrder - b.navOrder
    return a.label.localeCompare(b.label, 'es')
  })

  return {
    sidebar,
    routePermissions,
    activeModules: runnable,
    licensedModules: licensed,
    widgets,
    unavailable,
  }
}

/**
 * ¿Puede el usuario abrir esta ruta?
 *
 * Es la MISMA funcion que usa el servidor. Que la UI oculte el enlace no
 * basta: la ruta valida de nuevo y devuelve 403 (§8.3).
 */
export function canOpenRoute(
  path: string,
  result: HydrationResult,
  ctx: Omit<EvaluationContext, 'activeModules'>,
): boolean {
  const perm = result.routePermissions.get(path)
  // Aqui SI se usa activeModules: una ruta de un modulo sin manifest no
  // existe en este bundle, asi que no hay nada que abrir.
  if (perm === undefined) return false
  return hasPermission(perm, { ...ctx, activeModules: result.activeModules })
}

// ── Internos ───────────────────────────────────────────────────────────

/**
 * Comprueba un permiso sin necesitar el recurso concreto.
 *
 * El alcance ABAC (sucursal, monto, propiedad) se evalua despues, cuando ya
 * se sabe sobre que fila se actua. Aqui solo decidimos si el enlace existe.
 */
function hasPermission(perm: string, ctx: EvaluationContext): boolean {
  const moduleId = perm.split('.')[0] ?? ''
  if (!ctx.activeModules.has(moduleId)) return false

  const patterns = patternsFor(perm)
  if (patterns.some((p) => ctx.role.permissions[p] === false)) return false
  return patterns.some((p) => ctx.role.permissions[p] === true)
}

function patternsFor(action: string): string[] {
  const parts = action.split('.')
  const out: string[] = [action]
  for (let i = parts.length - 1; i > 0; i--) out.push(`${parts.slice(0, i).join('.')}.*`)
  const last = parts.at(-1)
  if (last && parts.length > 1) out.push(`*.${last}`)
  out.push('*')
  return out
}

function daysUntil(iso: string, now: Date): number {
  const ms = new Date(iso).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}
