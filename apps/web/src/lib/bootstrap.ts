import 'server-only'

import postgres from 'postgres'
import { hydrate, type ModuleManifest, type TenantModule } from '@regb/module-registry'
import type { Role } from '@regb/permissions'

import productsManifest from '@regb/mod-products'
import inventoryManifest from '@regb/mod-inventory'
import posManifest from '@regb/mod-pos'
import payrollManifest from '@regb/mod-payroll'
import invoiceCaptureManifest from '@regb/mod-invoice-capture'

/**
 * Bootstrap del shell.
 *
 * Documento maestro §2.3: la app arranca preguntando al servidor QUE modulos
 * tiene el cliente y QUE puede hacer este usuario. El sidebar se construye
 * con esa respuesta, no con una lista cableada.
 *
 * Ninguna regla de negocio vive aqui: solo lee y delega en el registry.
 */

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'

let client: postgres.Sql | undefined
function db(): postgres.Sql {
  client ??= postgres(DB_URL, { max: 4, onnotice: () => {} })
  return client
}

/**
 * Manifests disponibles en este bundle.
 *
 * Es lo unico que el shell "conoce" de los modulos, y aun asi no decide
 * nada: si el tenant no los tiene licenciados, no se cargan.
 */
export const MANIFESTS = new Map<string, ModuleManifest>(
  [productsManifest, inventoryManifest, posManifest, payrollManifest, invoiceCaptureManifest].map(
    (m) => [m.id, m],
  ),
)

export interface BootstrapResult {
  tenant: { id: string; name: string; tier: string; status: string }
  role: Role
  user: { id: string; name: string; initials: string }
  hydration: ReturnType<typeof hydrate>
}

/**
 * Ejecuta una consulta con la identidad de un usuario concreto.
 *
 * El `tenant_id` sale del JWT y de ningun otro sitio. Aqui simulamos ese
 * JWT porque el flujo de Supabase Auth aun no esta cableado (F0 S3), pero
 * la forma es la definitiva: RLS decide, no la aplicacion.
 */
async function asUser<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({
    sub: userId,
    app_metadata: { tenant_id: tenantId, is_provider: false },
  })
  return db().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

export async function bootstrap(
  tenantSlug: string,
  roleName: string,
  platform: 'web' | 'desktop' | 'mobile' = 'web',
): Promise<BootstrapResult | null> {
  const sql = db()

  // El tenant y el rol se resuelven fuera de RLS: es el equivalente al
  // login, que ocurre antes de que exista una sesion.
  const [tenant] = await sql<{ id: string; legal_name: string; tier: string; status: string }[]>`
    select id, legal_name, tier, status from regb.tenants where slug = ${tenantSlug}`
  if (!tenant) return null

  const [role] = await sql<
    {
      id: string
      name: string
      visible_modules: string[]
      permissions: Record<string, boolean>
      scope: Record<string, unknown>
    }[]
  >`select id, name, visible_modules, permissions, scope
      from public.roles where tenant_id = ${tenant.id} and name = ${roleName}`
  if (!role) return null

  const userId = '00000000-0000-0000-0000-000000000001'

  // A partir de aqui, TODO pasa por RLS.
  const tenantModules = await asUser(
    userId,
    tenant.id,
    (tx) => tx<
      { module_id: string; status: string; enabled: boolean; trial_ends_at: string | null }[]
    >`
      select module_id, status, enabled, trial_ends_at
      from regb.tenant_modules
      where tenant_id = ${tenant.id}`,
  )

  const hydration = hydrate({
    tenantModules: tenantModules.map((r): TenantModule => ({
      moduleId: r.module_id,
      status: r.status as TenantModule['status'],
      enabled: r.enabled,
      trialEndsAt: r.trial_ends_at,
    })),
    manifests: MANIFESTS,
    ctx: {
      userId,
      role: {
        id: role.id,
        name: role.name,
        visibleModules: role.visible_modules,
        permissions: role.permissions,
        scope: role.scope,
      },
    },
    platform,
  })

  return {
    tenant: { id: tenant.id, name: tenant.legal_name, tier: tenant.tier, status: tenant.status },
    role: {
      id: role.id,
      name: role.name,
      visibleModules: role.visible_modules,
      permissions: role.permissions,
      scope: role.scope,
    },
    user: { id: userId, name: 'Maria Rosario', initials: 'MR' },
    hydration,
  }
}

/** Empresas del tenant, para el rail. */
export async function listTenants(): Promise<
  { id: string; slug: string; name: string; initials: string }[]
> {
  const rows = await db()<{ id: string; slug: string; legal_name: string }[]>`
    select id, slug, legal_name from regb.tenants order by legal_name`
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.legal_name,
    initials: r.legal_name
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join(''),
  }))
}

/** Roles del tenant, para poder cambiar de perspectiva en la demo. */
export async function listRoles(tenantId: string): Promise<string[]> {
  const rows = await db()<{ name: string }[]>`
    select name from public.roles where tenant_id = ${tenantId} order by name`
  return rows.map((r) => r.name)
}
