import { notFound, redirect } from 'next/navigation'
import { checkAccess } from '@regb/sdk'
import { bootstrap, listTenants } from '@/lib/bootstrap'
import {
  cargarBaseCotizacion,
  cotizarConBase,
  loadCatalog,
  loadModuleDetail,
  loadSolicitudPendiente,
} from '@/lib/marketplace'
import { authConfigured, currentSession } from '@/lib/supabase'
import { cerrarDependencias, sePuedePedir } from '@/lib/catalog'
import { ModuleDetailView, type PedidoFicha, type Relacionado } from '@/components/ModuleDetailView'
import type { TenantTier } from '@regb/core'

export const dynamic = 'force-dynamic'

/**
 * Ficha de un modulo.
 *
 * Lo que hace falta para decidir una compra: que dolor quita, que trae,
 * como se ve DE VERDAD (captura real) y cuanto cuesta PARA ESTE CLIENTE.
 *
 * Los dos botones de abajo piden por la misma via que el simulador del
 * marketplace (`regb.activation_requests`). Como hay a lo sumo UNA
 * solicitud abierta por cliente y pedir la reemplaza, aqui se arma el
 * pedido completo en el servidor: lo que ya tenia pedido + este modulo +
 * sus requisitos. Si no, pedir desde la ficha borraria en silencio lo que
 * el cliente pidio antes desde el simulador.
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
  let userId: string
  let tier: TenantTier
  let volver: string
  let demoQuery: string
  let hiddenFields: Record<string, string>

  if (authConfigured) {
    const session = await currentSession()
    if (!session) redirect('/login')
    if (checkAccess(session).blocked) redirect('/sin-acceso')
    const data = await bootstrap({ session })
    if (!data) redirect('/sin-acceso')
    tenantId = data.tenant.id
    userId = data.user.id
    tier = data.tenant.tier as TenantTier
    volver = '/marketplace'
    demoQuery = ''
    hiddenFields = {}
  } else {
    const tenants = await listTenants()
    if (tenants.length === 0) redirect('/')
    const slug = q.tenant ?? tenants[0]!.slug
    const rol = q.rol ?? 'Owner'
    const data = await bootstrap({ demo: { tenantSlug: slug, roleName: rol } })
    if (!data) redirect('/')
    tenantId = data.tenant.id
    userId = data.user.id
    tier = data.tenant.tier as TenantTier
    demoQuery = `?tenant=${encodeURIComponent(slug)}&rol=${encodeURIComponent(rol)}`
    volver = `/marketplace${demoQuery}`
    hiddenFields = { tenant: slug, rol }
  }

  const [mod, catalog, pendiente, base] = await Promise.all([
    loadModuleDetail(id, tenantId, tier),
    loadCatalog(tenantId, tier),
    loadSolicitudPendiente(userId, tenantId),
    cargarBaseCotizacion(tenantId),
  ])
  if (!mod) notFound()

  const porId = new Map(catalog.map((m) => [m.id, m]))
  const enCatalogo = porId.get(mod.id)
  const yaPedido = pendiente?.modules.includes(mod.id) ?? false

  // El pedido que mandan los botones: lo pendiente + este + sus requisitos.
  let pedido: PedidoFicha | null = null
  if (enCatalogo && sePuedePedir(enCatalogo) && base) {
    const { total, anadidos } = cerrarDependencias([mod.id], porId)
    // Lo que se ensena lo calcula el motor de facturacion: cuanto sube la
    // factura con este modulo y sus requisitos (ITBIS e incluidos del plan
    // dentro). Lo que se GUARDA al pedir lo recalcula el servidor igual.
    const este = cotizarConBase(base, total)
    pedido = {
      modulos: [...new Set([...(pendiente?.modules ?? []), ...total])],
      nota: pendiente?.nota ?? null,
      requisitos: anadidos.map((r) => ({ id: r, name: porId.get(r)?.name ?? r })),
      este: {
        hoy: este.hoy.total,
        con: este.conSeleccion.total,
        aumento: este.aumento,
        instalacion: este.instalacionTotal,
      },
      previos: (pendiente?.modules ?? []).filter((m) => !total.has(m)).length,
    }
  }

  const relacion = (ids: string[]): Relacionado[] =>
    ids.flatMap((r) => {
      const m = porId.get(r)
      if (!m) return []
      return [
        {
          id: m.id,
          name: m.name,
          icon: m.icon,
          tiene: m.status === 'active' || m.status === 'trial' || m.category === 'core',
          publicado: m.isPublished,
        },
      ]
    })

  return (
    <ModuleDetailView
      mod={mod}
      tier={tier}
      backHref={volver}
      demoQuery={demoQuery}
      hiddenFields={hiddenFields}
      pedido={pedido}
      yaPedido={yaPedido}
      necesita={relacion(mod.requires)}
      combina={relacion(mod.recommends)}
    />
  )
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `${id} · Marketplace · REGB ERP` }
}
