import { redirect } from 'next/navigation'
import { checkAccess } from '@regb/sdk'
import { can } from '@regb/permissions'
import { bootstrap, listTenants } from '@/lib/bootstrap'
import { loadModuleOptions, loadRoles } from '@/lib/roles'
import { authConfigured, currentSession } from '@/lib/supabase'
import { RolesEditor } from '@/components/RolesEditor'
import { GuiaFlotante } from '@/components/GuiaFlotante'
import { guiaDelPaso } from '@/lib/module-page'

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
  searchParams: Promise<{ tenant?: string; rol?: string; tour?: string; paso?: string }>
}) {
  const params = await searchParams

  let tenantId: string
  let userId: string
  let tenantName: string
  let backHref: string
  let canEdit: boolean
  let demo: { tenantSlug: string; roleName: string } | undefined

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
    canEdit = can(
      'rbac.role.edit',
      { module: 'rbac' },
      { userId: data.user.id, role: data.role, activeModules: data.hydration.licensedModules },
    ).allowed
  } else {
    const tenants = await listTenants()
    if (tenants.length === 0) redirect('/')
    const slug = params.tenant ?? tenants[0]!.slug
    const roleName = params.rol ?? 'Owner'
    demo = { tenantSlug: slug, roleName }
    const data = await bootstrap({ demo })
    if (!data) redirect('/')
    tenantId = data.tenant.id
    userId = data.user.id
    tenantName = data.tenant.name
    backHref = `/?tenant=${slug}&rol=${encodeURIComponent(roleName)}`
    canEdit = can(
      'rbac.role.edit',
      { module: 'rbac' },
      { userId: data.user.id, role: data.role, activeModules: data.hydration.licensedModules },
    ).allowed
  }

  const [roles, modules] = await Promise.all([
    loadRoles(userId, tenantId),
    loadModuleOptions(tenantId),
  ])

  // Esta pantalla no pinta el Shell -ocupa el ancho entero-, asi que la
  // guia del tour se monta aqui a mano. Dos tours aterrizan en /roles.
  const guia = guiaDelPaso(
    params,
    demo ? `?tenant=${demo.tenantSlug}&rol=${encodeURIComponent(demo.roleName)}` : '',
  )

  return (
    <>
      <RolesEditor
        roles={roles}
        modules={modules}
        tenantName={tenantName}
        backHref={backHref}
        demo={demo}
        canEdit={canEdit}
      />
      {guia !== undefined && <GuiaFlotante guia={guia} />}
    </>
  )
}
