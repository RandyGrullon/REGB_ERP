import { bootstrap, listRoles, listTenants } from '@/lib/bootstrap'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'

/**
 * Pantalla principal.
 *
 * Es un Server Component: consulta el bootstrap en el servidor y manda al
 * cliente solo lo que el usuario puede ver. Si un modulo no esta licenciado
 * o el rol no lo alcanza, ni siquiera viaja en el HTML.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; plataforma?: string }>
}) {
  const params = await searchParams
  const tenants = await listTenants()

  if (tenants.length === 0) {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="text-5xl">🗄️</p>
          <h1 className="mt-4 text-xl font-semibold">No hay ningun cliente todavia</h1>
          <p className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">
            Levanta la base de datos y aplica las migraciones y el seed de demostracion:
          </p>
          <pre className="mt-4 rounded-lg bg-[var(--color-surface-raised)] p-4 text-left text-xs">
            docker start nexus-test-db{'\n'}
            pnpm --filter @nexus/db migrate{'\n'}
            pnpm --filter @nexus/db seed:demo
          </pre>
        </div>
      </main>
    )
  }

  const slug = params.tenant ?? tenants[0]!.slug
  const roleName = params.rol ?? 'Owner'
  const platform = (params.plataforma ?? 'web') as 'web' | 'desktop' | 'mobile'

  const data = await bootstrap(slug, roleName, platform)
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
