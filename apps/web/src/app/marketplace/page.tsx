import { redirect } from 'next/navigation'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listTenants } from '@/lib/bootstrap'
import { loadCatalog } from '@/lib/marketplace'
import { asUser } from '@/lib/db'
import { authConfigured, currentSession } from '@/lib/supabase'
import { MarketplaceView } from '@/components/MarketplaceView'
import { GuiaFlotante } from '@/components/GuiaFlotante'
import { guiaDelPaso } from '@/lib/module-page'
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
  searchParams: Promise<{ tenant?: string; rol?: string; tour?: string; paso?: string }>
}) {
  const params = await searchParams

  let tenantId: string
  let userId: string
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
    userId = data.user.id
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
    userId = data.user.id
    tier = data.tenant.tier as TenantTier
    tenantName = data.tenant.name
    roleName = data.role.name
  }

  const catalog = await loadCatalog(tenantId, tier)

  // Si ya hay una peticion abierta el cliente tiene que verlo, o vuelve a
  // pulsar el boton creyendo que la primera vez no funciono.
  const [pendiente] = await asUser(
    userId,
    tenantId,
    (tx) => tx<{ modules: string[]; created_at: string }[]>`
      select modules, created_at::text
      from regb.activation_requests
      where tenant_id = ${tenantId} and status = 'pending'`,
  )

  // Igual que /roles: esta pantalla no pinta el Shell, asi que la guia
  // del tour se monta aqui. El tour del marketplace aterriza justo aqui.
  const guia = guiaDelPaso(
    params,
    authConfigured ? '' : `?tenant=${params.tenant ?? ''}&rol=${params.rol ?? 'Owner'}`,
  )

  return (
    <>
    <MarketplaceView
      catalog={catalog}
      tier={tier}
      tenantName={tenantName}
      roleName={roleName}
      backHref={
        authConfigured ? '/' : `/?tenant=${params.tenant ?? ''}&rol=${params.rol ?? 'Owner'}`
      }
      hiddenFields={
        authConfigured ? {} : { tenant: params.tenant ?? '', rol: params.rol ?? 'Owner' }
      }
      solicitudPendiente={
        pendiente ? { modules: pendiente.modules, createdAt: pendiente.created_at } : null
      }
    />
    {guia !== undefined && <GuiaFlotante guia={guia} />}
    </>
  )
}
