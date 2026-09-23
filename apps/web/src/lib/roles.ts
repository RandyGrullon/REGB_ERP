import 'server-only'

import { asUser, db } from './db'

/**
 * Lectura y escritura de roles (§8.4).
 *
 * Toda escritura pasa por `asUser`, es decir por RLS: un admin no puede
 * tocar los roles de otro cliente aunque manipule el formulario.
 */

export interface RoleRow {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  visibleModules: string[]
  permissions: Record<string, boolean>
  scope: Record<string, unknown>
  /** Cuanta gente tiene este rol. */
  memberCount: number
}

export interface ModuleOption {
  id: string
  name: string
  category: string
  /** Permisos que el modulo declara, para pintar la matriz. */
  permissions: string[]
}

export async function loadRoles(userId: string, tenantId: string): Promise<RoleRow[]> {
  const rows = await asUser(
    userId,
    tenantId,
    (tx) => tx<
      {
        id: string
        name: string
        description: string | null
        is_system: boolean
        visible_modules: string[]
        permissions: Record<string, boolean>
        scope: Record<string, unknown>
        member_count: string
      }[]
    >`
      select r.id, r.name, r.description, r.is_system,
             r.visible_modules, r.permissions, r.scope,
             count(m.id) filter (where m.is_active) as member_count
      from public.roles r
      left join public.memberships m on m.role_id = r.id
      where r.tenant_id = ${tenantId}
      group by r.id
      order by r.is_system desc, r.name`,
  )

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    visibleModules: r.visible_modules,
    permissions: r.permissions,
    scope: r.scope,
    memberCount: Number(r.member_count),
  }))
}

/**
 * Modulos activos del cliente, con los permisos que declara cada uno.
 *
 * La matriz de permisos solo muestra lo que el cliente TIENE. No tiene
 * sentido configurar permisos de nomina si no la compro.
 */
export async function loadModuleOptions(tenantId: string): Promise<ModuleOption[]> {
  const rows = await db()<{ id: string; name: string; category: string; permissions: string[] }[]>`
    select mc.id, mc.name, mc.category, mc.permissions
    from regb.module_catalog mc
    join regb.tenant_modules tm on tm.module_id = mc.id
    where tm.tenant_id = ${tenantId}
      -- Una prueba vencida ya no esta activa (0128, rls.module_active()):
      -- no tiene sentido dar permisos sobre un modulo que no se ve.
      and (tm.status = 'active'
           or (tm.status = 'trial' and (tm.trial_ends_at is null or tm.trial_ends_at >= current_date)))
      and tm.enabled
    order by
      case mc.category
        when 'core' then 1 when 'standard' then 2 when 'advanced' then 3
        when 'vertical' then 4 else 5 end,
      mc.name`

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    permissions: r.permissions,
  }))
}
