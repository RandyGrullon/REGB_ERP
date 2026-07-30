import { redirect } from 'next/navigation'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listRoles, listTenants } from '@/lib/bootstrap'
import { authConfigured, currentSession } from '@/lib/supabase'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'

/**
 * Pantalla principal.
 *
 * Server Component: resuelve el bootstrap en el servidor y manda al cliente
 * solo lo que el usuario puede ver. Un modulo no licenciado ni siquiera
 * viaja en el HTML.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    tenant?: string
    rol?: string
    plataforma?: string
    impersonando?: string
  }>
}) {
  const params = await searchParams
  const platform = (params.plataforma ?? 'web') as 'web' | 'desktop' | 'mobile'

  // ── Camino real: hay Supabase y hay sesion ───────────────────────────
  if (authConfigured) {
    const session = await currentSession()
    if (!session) redirect('/login')

    const acceso = checkAccess(session)
    if (acceso.blocked) redirect('/sin-acceso')

    const data = await bootstrap({ session, platform })
    if (!data) redirect('/sin-acceso')

    return (
      <Shell
        tenants={[
          {
            id: data.tenant.id,
            slug: data.tenant.id,
            name: data.tenant.name,
            initials: data.user.initials,
            tier: data.tenant.tier,
          },
        ]}
        activeSlug={data.tenant.id}
        roles={[data.role.name]}
        activeRole={data.role.name}
        activePlatform={platform}
        demoMode={false}
        isProvider={session.isProvider}
        data={{
          tenant: data.tenant,
          user: data.user,
          roleName: data.role.name,
          sidebar: data.hydration.sidebar,
          activeModules: [...data.hydration.activeModules],
          widgets: data.hydration.widgets,
          unavailable: data.hydration.unavailable,
          routeCount: data.hydration.routePermissions.size,
        }}
      />
    )
  }

  // ── Modo demostracion: sin Supabase, se elige tenant y rol por URL ───
  const tenants = await listTenants()

  if (tenants.length === 0) {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="text-5xl">🗄️</p>
          <h1 className="mt-4 text-xl font-semibold">No hay ningun cliente todavia</h1>
          <p className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">
            Levanta la base de datos y aplica las migraciones y el seed:
          </p>
          <pre className="mt-4 rounded-lg bg-[var(--color-surface-raised)] p-4 text-left text-xs">
            docker start regb-test-db{'\n'}
            pnpm --filter @regb/db migrate{'\n'}
            pnpm --filter @regb/db seed:demo
          </pre>
        </div>
      </main>
    )
  }

  const slug = params.tenant ?? tenants[0]!.slug
  const roleName = params.rol ?? 'Owner'

  const data = await bootstrap({ demo: { tenantSlug: slug, roleName }, platform })
  if (!data) {
    return (
      <main className="grid h-full place-items-center p-8">
        <p>
          No se encontro el cliente &quot;{slug}&quot; o el rol &quot;{roleName}&quot;.
        </p>
      </main>
    )
  }

  const roles = await listRoles(data.tenant.id)

  return (
    <Shell
      tenants={tenants}
      activeSlug={slug}
      roles={roles}
      activeRole={roleName}
      activePlatform={platform}
      demoMode
      impersonating={params.impersonando === '1'}
      data={{
        tenant: data.tenant,
        user: data.user,
        roleName: data.role.name,
        sidebar: data.hydration.sidebar,
        activeModules: [...data.hydration.activeModules],
        widgets: data.hydration.widgets,
        unavailable: data.hydration.unavailable,
        routeCount: data.hydration.routePermissions.size,
      }}
    />
  )
}
