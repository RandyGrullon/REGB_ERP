import 'server-only'

import { notFound, redirect } from 'next/navigation'
import { can, type Role } from '@regb/permissions'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listRoles, listTenants, type BootstrapResult } from './bootstrap'
import { authConfigured, currentSession } from './supabase'
import { asUser } from './db'
import type { ShellProps } from '@/components/Shell'
import type { SearchEntry } from '@/components/GlobalSearch'

/**
 * Contexto comun de las paginas y acciones de modulo.
 *
 * Toda pagina de modulo hace lo mismo: resolver quien mira (sesion real o
 * demo por URL), verificar el permiso EN SERVIDOR (que la UI oculte el
 * enlace no cuenta, §8.3) y trabajar bajo RLS via asUser. Esto centraliza
 * los dos primeros; el tercero es responsabilidad de cada query.
 */

export interface ModulePageCtx {
  userId: string
  tenantId: string
  tenantSlug: string
  tenantName: string
  role: Role
  roleName: string
  licensedModules: Set<string>
  /** Query string para propagar tenant/rol en modo demostracion. */
  demoQs: string
}

/**
 * `| undefined` explicito: con exactOptionalPropertyTypes, "puede faltar"
 * y "puede valer undefined" son cosas distintas, y quien llama pasa lo
 * segundo (formData.get devuelve string | undefined).
 */
export type DemoParams = {
  tenant?: string | undefined
  rol?: string | undefined
  plataforma?: string | undefined
}

export type ActionResult = { ok: true } | { ok: false; error: string }

interface Resolved {
  data: BootstrapResult
  ctx: ModulePageCtx
  demo: boolean
}

async function resolve(params: DemoParams): Promise<Resolved | null> {
  if (authConfigured) {
    const session = await currentSession()
    if (!session?.tenantId) return null
    if (checkAccess(session).blocked) return null
    const data = await bootstrap({ session })
    if (!data) return null
    return {
      data,
      demo: false,
      ctx: {
        userId: data.user.id,
        tenantId: data.tenant.id,
        tenantSlug: data.tenant.id,
        tenantName: data.tenant.name,
        role: data.role,
        roleName: data.role.name,
        licensedModules: data.hydration.licensedModules,
        demoQs: '',
      },
    }
  }

  const tenants = await listTenants()
  if (tenants.length === 0) return null
  const slug = params.tenant ?? tenants[0]!.slug
  const roleName = params.rol ?? 'Owner'
  const data = await bootstrap({ demo: { tenantSlug: slug, roleName } })
  if (!data) return null
  return {
    data,
    demo: true,
    ctx: {
      userId: data.user.id,
      tenantId: data.tenant.id,
      tenantSlug: slug,
      tenantName: data.tenant.name,
      role: data.role,
      roleName,
      licensedModules: data.hydration.licensedModules,
      demoQs: `?tenant=${slug}&rol=${encodeURIComponent(roleName)}`,
    },
  }
}

/**
 * Pagina de modulo completa: contexto + props del Shell.
 * Sin sesion redirige; sin permiso de ver, la ruta "no existe" (404).
 */
export async function modulePage(
  params: DemoParams,
  moduleId: string,
): Promise<{ ctx: ModulePageCtx; shell: Omit<ShellProps, 'children' | 'activePath'> }> {
  const r = await resolve(params)
  if (!r) redirect(authConfigured ? '/login' : '/')

  if (!exigir(r.ctx, moduleId, `${moduleId}.view`).ok) notFound()

  const platform = (params.plataforma ?? 'web') as 'web' | 'desktop' | 'mobile'
  const tenants = r.demo
    ? await listTenants()
    : [
        {
          id: r.data.tenant.id,
          slug: r.data.tenant.id,
          name: r.data.tenant.name,
          initials: r.data.user.initials,
          tier: r.data.tenant.tier,
        },
      ]
  const roles = r.demo ? await listRoles(r.ctx.tenantId) : [r.ctx.roleName]
  const [unread, search] = await Promise.all([unreadCount(r.ctx), buildSearchIndex(r)])
  const session = r.demo ? null : await currentSession()

  return {
    ctx: r.ctx,
    shell: {
      tenants,
      activeSlug: r.ctx.tenantSlug,
      roles,
      activeRole: r.ctx.roleName,
      activePlatform: platform,
      demoMode: r.demo,
      isProvider: session?.isProvider ?? false,
      data: {
        tenant: r.data.tenant,
        user: r.data.user,
        roleName: r.ctx.roleName,
        sidebar: r.data.hydration.sidebar,
        activeModules: [...r.data.hydration.activeModules],
        widgets: r.data.hydration.widgets,
        unavailable: r.data.hydration.unavailable,
        routeCount: r.data.hydration.routePermissions.size,
        unread,
        search,
      },
    },
  }
}

async function unreadCount(ctx: ModulePageCtx): Promise<number> {
  if (!ctx.licensedModules.has('notifications')) return 0
  const [row] = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<{ c: string }[]>`
      select count(*) as c from public.notifications
      where tenant_id = ${ctx.tenantId}
        and (user_id = ${ctx.userId} or user_id is null)
        and read_at is null`,
  )
  return Number(row?.c ?? 0)
}

/**
 * Indice de Ctrl+K (puerta F2): modulos, registros, acciones y ayuda.
 * Se construye del sidebar YA RESUELTO por rol — la busqueda no puede
 * encontrar lo que el rol no ve.
 */
async function buildSearchIndex(r: Resolved): Promise<SearchEntry[]> {
  const entries: SearchEntry[] = []

  for (const mod of r.data.hydration.sidebar) {
    for (const route of mod.routes) {
      entries.push({
        type: 'modulo',
        label: route.label,
        detail: mod.label,
        path: route.path,
        keywords: mod.moduleId,
      })
    }
  }

  const ACCIONES: (SearchEntry & { need: string })[] = [
    { type: 'accion', label: 'Invitar a alguien al equipo', path: '/usuarios', need: 'users' },
    { type: 'accion', label: 'Crear un rol o cambiar permisos', path: '/roles', need: 'rbac' },
    { type: 'accion', label: 'Agregar una empresa (RNC)', path: '/empresas', need: 'orgs' },
    { type: 'accion', label: 'Abrir una sucursal', path: '/sucursales', need: 'branches' },
    { type: 'accion', label: 'Activar un modulo nuevo', path: '/marketplace', need: 'marketplace' },
    { type: 'accion', label: 'Importar productos desde CSV', path: '/importar', need: 'imports' },
    { type: 'accion', label: 'Crear un respaldo de mis datos', path: '/respaldos', need: 'backup' },
  ]
  for (const a of ACCIONES) {
    if (r.ctx.licensedModules.has(a.need)) {
      entries.push({ type: a.type, label: a.label, path: a.path })
    }
  }

  const AYUDA: SearchEntry[] = [
    { type: 'ayuda', label: 'Primeros pasos en REGB', path: '/tutorial', keywords: 'tour ayuda' },
    {
      type: 'ayuda',
      label: 'Como ocultar modulos a un rol',
      path: '/tutorial',
      keywords: 'permisos',
    },
    {
      type: 'ayuda',
      label: 'Como funciona el marketplace',
      path: '/tutorial',
      keywords: 'precios',
    },
  ]
  if (r.ctx.licensedModules.has('tour')) entries.push(...AYUDA)

  // Registros: nombres reales del tenant, bajo RLS.
  const rows = await asUser(r.ctx.userId, r.ctx.tenantId, async (tx) => {
    const productos = r.ctx.licensedModules.has('products')
      ? await tx<{ name: string; sku: string }[]>`
          select name, sku from public.products
          where tenant_id = ${r.ctx.tenantId} and active
          order by name limit 50`
      : []
    const gente = r.ctx.licensedModules.has('users')
      ? await tx<{ display_name: string }[]>`
          select display_name from public.user_profiles
          where tenant_id = ${r.ctx.tenantId} order by display_name limit 50`
      : []
    return { productos, gente }
  })
  for (const p of rows.productos) {
    entries.push({
      type: 'registro',
      label: p.name,
      detail: `Producto · ${p.sku}`,
      path: '/products',
    })
  }
  for (const g of rows.gente) {
    entries.push({ type: 'registro', label: g.display_name, detail: 'Usuario', path: '/usuarios' })
  }

  return entries
}

/** Para server actions: devuelve null en vez de redirigir. */
export async function actionCtx(demo?: DemoParams): Promise<ModulePageCtx | null> {
  const r = await resolve(demo ?? {})
  return r?.ctx ?? null
}

/** Permiso en servidor, con el motivo exacto si se niega. */
/**
 * `amount` es opcional: solo lo usan las acciones cuyo rol puede traer un
 * `max_amount` en su alcance (por ejemplo, un ajuste de inventario que
 * necesita aprobacion del gerente por encima de cierto monto).
 */
export function exigir(
  ctx: ModulePageCtx,
  moduleId: string,
  accion: string,
  amount?: number,
): ActionResult {
  const d = can(
    accion,
    { module: moduleId, ...(amount !== undefined ? { amount } : {}) },
    { userId: ctx.userId, role: ctx.role, activeModules: ctx.licensedModules },
  )
  return d.allowed ? { ok: true } : { ok: false, error: d.detail }
}
