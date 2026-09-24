import { notFound, redirect } from 'next/navigation'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listTenants } from '@/lib/bootstrap'
import {
  cargarBaseCotizacion,
  cotizarConBase,
  loadCatalog,
  loadSolicitudPendiente,
} from '@/lib/marketplace'
import {
  PAQUETES,
  cerrarDependencias,
  seleccionDesdeSolicitud,
  sePuedePedir,
  type CatalogEntry,
} from '@/lib/catalog'
import { authConfigured, currentSession } from '@/lib/supabase'
import { MarketplaceView } from '@/components/MarketplaceView'
import { GuiaFlotante } from '@/components/GuiaFlotante'
import { accesoMarketplace, guiaDelPaso } from '@/lib/module-page'
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
  let acceso: { ver: boolean; pedir: boolean }
  let demoQuery = ''
  let hiddenFields: Record<string, string> = {}

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
    acceso = accesoMarketplace(data.user.id, data.role)
  } else {
    const tenants = await listTenants()
    if (tenants.length === 0) redirect('/')
    const slug = params.tenant || tenants[0]!.slug
    const rol = params.rol || 'Owner'
    const data = await bootstrap({ demo: { tenantSlug: slug, roleName: rol } })
    if (!data) redirect('/')
    tenantId = data.tenant.id
    userId = data.user.id
    tier = data.tenant.tier as TenantTier
    tenantName = data.tenant.name
    roleName = data.role.name
    acceso = accesoMarketplace(data.user.id, data.role)
    // Con el slug YA resuelto: sin `?tenant=` los enlaces a las fichas
    // llevaban `tenant=` vacio y la ficha rebotaba al inicio.
    demoQuery = `?tenant=${encodeURIComponent(slug)}&rol=${encodeURIComponent(rol)}`
    hiddenFields = { tenant: slug, rol }
  }

  if (!acceso.ver) notFound()

  const [catalog, pendiente, base] = await Promise.all([
    loadCatalog(tenantId, tier),
    // Si ya hay una peticion abierta el cliente tiene que verlo, o vuelve a
    // pulsar el boton creyendo que la primera vez no funciono.
    loadSolicitudPendiente(userId, tenantId),
    cargarBaseCotizacion(tenantId),
  ])

  // Todo monto de la pantalla sale del motor de facturacion
  // (`@regb/billing`), no de sumar precios de lista: la factura de hoy, la
  // de lo que llega marcado y lo que sumaria cada paquete.
  const porId = new Map<string, CatalogEntry>(catalog.map((m) => [m.id, m]))
  const inicial = cerrarDependencias(seleccionDesdeSolicitud(pendiente, porId), porId).total
  const cotizacionInicial = base ? cotizarConBase(base, inicial) : null
  const cotizacionesPaquetes: Record<string, { aumento: number; instalacion: number }> = {}
  if (base) {
    for (const p of PAQUETES) {
      const faltan = p.modulos.filter((id) => {
        const m = porId.get(id)
        return m !== undefined && sePuedePedir(m)
      })
      if (faltan.length === 0) continue
      const c = cotizarConBase(base, cerrarDependencias(faltan, porId).total)
      cotizacionesPaquetes[p.id] = { aumento: c.aumento, instalacion: c.instalacionTotal }
    }
  }

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
        backHref={authConfigured ? '/' : `/${demoQuery}`}
        demoQuery={demoQuery}
        hiddenFields={hiddenFields}
        solicitudPendiente={pendiente}
        cotizacionInicial={cotizacionInicial}
        cotizacionesPaquetes={cotizacionesPaquetes}
        puedePedir={acceso.pedir}
      />
      {guia !== undefined && <GuiaFlotante guia={guia} />}
    </>
  )
}
