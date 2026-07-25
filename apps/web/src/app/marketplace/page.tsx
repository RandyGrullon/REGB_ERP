import { redirect } from 'next/navigation'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listTenants } from '@/lib/bootstrap'
import { loadCatalog } from '@/lib/marketplace'
import { authConfigured, currentSession } from '@/lib/supabase'
import { MarketplaceView } from '@/components/MarketplaceView'
import type { TenantTier } from '@regb/core'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Marketplace · REGB ERP' }

/**
 * Marketplace de modulos (§12.3).
 *
 * Cada tarjeta muestra el precio PARA EL TIER DE ESTE CLIENTE. Un colmado
 * y un grupo industrial ven el mismo modulo con precios distintos, que es
 * exactamente el modelo de negocio.
 */
export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string }>
}) {
  const params = await searchParams

  let tenantId: string
  let tier: TenantTier
  let tenantName: string
  let roleName: string

  if (authConfigured) {
    const session = await currentSession()
    if (!session) redirect('/login')
    if (checkAccess(session).blocked) redirect('/sin-acceso')

    const data = await bootstrap({ session })
    if (!data) redirect('/sin-acceso')
    tenantId = data.tenant.id
    tier = data.tenant.tier as TenantTier
    tenantName = data.tenant.name
    roleName = data.role.name
  } else {
    const tenants = await listTenants()
    if (tenants.length === 0) redirect('/')
    const slug = params.tenant ?? tenants[0]!.slug
    const data = await bootstrap({
      demo: { tenantSlug: slug, roleName: params.rol ?? 'Owner' },
    })
    if (!data) redirect('/')
    tenantId = data.tenant.id
    tier = data.tenant.tier as TenantTier
    tenantName = data.tenant.name
    roleName = data.role.name
  }

  const catalog = await loadCatalog(tenantId, tier)

  return (
    <MarketplaceView
      catalog={catalog}
      tier={tier}
      tenantName={tenantName}
      roleName={roleName}
      backHref={
        authConfigured ? '/' : `/?tenant=${params.tenant ?? ''}&rol=${params.rol ?? 'Owner'}`
      }
    />
  )
}
