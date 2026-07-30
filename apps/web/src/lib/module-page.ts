import 'server-only'

import { notFound, redirect } from 'next/navigation'
import { can, type Role } from '@regb/permissions'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listRoles, listTenants, type BootstrapResult } from './bootstrap'
import { authConfigured, currentSession } from './supabase'
import type { ShellProps } from '@/components/Shell'

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

  return {
    ctx: r.ctx,
    shell: {
      tenants,
      activeSlug: r.ctx.tenantSlug,
      roles,
      activeRole: r.ctx.roleName,
      activePlatform: platform,
      demoMode: r.demo,
      data: {
        tenant: r.data.tenant,
        user: r.data.user,
        roleName: r.ctx.roleName,
        sidebar: r.data.hydration.sidebar,
        activeModules: [...r.data.hydration.activeModules],
        widgets: r.data.hydration.widgets,
        unavailable: r.data.hydration.unavailable,
        routeCount: r.data.hydration.routePermissions.size,
      },
    },
  }
}

/** Para server actions: devuelve null en vez de redirigir. */
export async function actionCtx(demo?: DemoParams): Promise<ModulePageCtx | null> {
  const r = await resolve(demo ?? {})
  return r?.ctx ?? null
}

/** Permiso en servidor, con el motivo exacto si se niega. */
export function exigir(ctx: ModulePageCtx, moduleId: string, accion: string): ActionResult {
  const d = can(
    accion,
    { module: moduleId },
    { userId: ctx.userId, role: ctx.role, activeModules: ctx.licensedModules },
  )
  return d.allowed ? { ok: true } : { ok: false, error: d.detail }
}
