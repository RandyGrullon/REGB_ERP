import { redirect } from 'next/navigation'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listTenants } from '@/lib/bootstrap'
import { loadModuleOptions, loadRoles } from '@/lib/roles'
import { authConfigured, currentSession } from '@/lib/supabase'
import { RolesEditor } from '@/components/RolesEditor'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Roles y permisos · REGB ERP' }

/**
 * Editor visual de roles y permisos (§8.4).
 *
 * Es la pantalla que hace que el cliente no dependa de ti para configurar
 * quien ve que. Hasta ahora los roles se cambiaban por URL.
 */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string }>
}) {
  const params = await searchParams

  let tenantId: string
  let userId: string
  let tenantName: string
  let backHref: string

  if (authConfigured) {
    const session = await currentSession()
    if (!session) redirect('/login')
    if (checkAccess(session).blocked) redirect('/sin-acceso')
    const data = await bootstrap({ session })
    if (!data) redirect('/sin-acceso')
    tenantId = data.tenant.id
    userId = data.user.id
    tenantName = data.tenant.name
    backHref = '/'
  } else {
    const tenants = await listTenants()
    if (tenants.length === 0) redirect('/')
    const slug = params.tenant ?? tenants[0]!.slug
    const data = await bootstrap({
      demo: { tenantSlug: slug, roleName: params.rol ?? 'Owner' },
    })
    if (!data) redirect('/')
    tenantId = data.tenant.id
    userId = data.user.id
    tenantName = data.tenant.name
    backHref = `/?tenant=${slug}&rol=${encodeURIComponent(params.rol ?? 'Owner')}`
  }

  const [roles, modules] = await Promise.all([
    loadRoles(userId, tenantId),
    loadModuleOptions(tenantId),
  ])

  return <RolesEditor roles={roles} modules={modules} tenantName={tenantName} backHref={backHref} />
}
