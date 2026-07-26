import { notFound, redirect } from 'next/navigation'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listTenants } from '@/lib/bootstrap'
import { loadModuleDetail } from '@/lib/marketplace'
import { authConfigured, currentSession } from '@/lib/supabase'
import { ModuleDetailView } from '@/components/ModuleDetailView'
import type { TenantTier } from '@regb/core'

export const dynamic = 'force-dynamic'

/**
 * Ficha de un modulo.
 *
 * Lo que hace falta para decidir una compra: que dolor quita, que trae,
 * como se ve y cuanto cuesta PARA ESTE CLIENTE.
 */
export default async function ModuleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tenant?: string; rol?: string }>
}) {
  const { id } = await params
  const q = await searchParams

  let tenantId: string
  let tier: TenantTier
  let volver: string

  if (authConfigured) {
    const session = await currentSession()
    if (!session) redirect('/login')
    if (checkAccess(session).blocked) redirect('/sin-acceso')
    const data = await bootstrap({ session })
    if (!data) redirect('/sin-acceso')
    tenantId = data.tenant.id
    tier = data.tenant.tier as TenantTier
    volver = '/marketplace'
  } else {
    const tenants = await listTenants()
    if (tenants.length === 0) redirect('/')
    const slug = q.tenant ?? tenants[0]!.slug
    const rol = q.rol ?? 'Owner'
    const data = await bootstrap({ demo: { tenantSlug: slug, roleName: rol } })
    if (!data) redirect('/')
    tenantId = data.tenant.id
    tier = data.tenant.tier as TenantTier
    volver = `/marketplace?tenant=${slug}&rol=${encodeURIComponent(rol)}`
  }

  const mod = await loadModuleDetail(id, tenantId, tier)
  if (!mod) notFound()

  return <ModuleDetailView mod={mod} tier={tier} backHref={volver} />
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `${id} · Marketplace · REGB ERP` }
}
