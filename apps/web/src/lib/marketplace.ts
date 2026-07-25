import 'server-only'

import { db } from './db'
import type { CatalogEntry } from './catalog'
import type { TenantTier } from '@regb/core'

/**
 * Consulta del marketplace (§12.3).
 *
 * Lee el catalogo y lo cruza con lo que el cliente ya tiene, para que cada
 * tarjeta sepa si esta activa, en prueba o disponible — y a que precio
 * para SU tier.
 *
 * Los tipos viven en `catalog.ts` porque el componente cliente los usa y
 * este modulo es server-only.
 */
export async function loadCatalog(tenantId: string, tier: TenantTier): Promise<CatalogEntry[]> {
  const rows = await db()<
    {
      id: string
      name: string
      description: string | null
      icon: string
      category: CatalogEntry['category']
      requires: string[]
      recommends: string[]
      platforms: CatalogEntry['platforms']
      is_published: boolean
      install_price: string
      monthly_price: string
      status: CatalogEntry['status']
      enabled: boolean | null
      trial_ends_at: string | null
    }[]
  >`
    select
      mc.id, mc.name, mc.description, mc.icon, mc.category,
      mc.requires, mc.recommends, mc.platforms, mc.is_published,
      mp.install_price, mp.monthly_price,
      tm.status, tm.enabled, tm.trial_ends_at
    from regb.module_catalog mc
    join regb.module_pricing mp
      on mp.module_id = mc.id and mp.tier = ${tier}::regb.tenant_tier
    left join regb.tenant_modules tm
      on tm.module_id = mc.id and tm.tenant_id = ${tenantId}
    order by
      case mc.category
        when 'core' then 1 when 'standard' then 2 when 'advanced' then 3
        when 'vertical' then 4 else 5 end,
      mc.name`

  // Lo que el cliente ya tiene activo, para calcular dependencias faltantes.
  const activos = new Set(
    rows.filter((r) => r.status === 'active' || r.status === 'trial').map((r) => r.id),
  )

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    icon: r.icon,
    category: r.category,
    requires: r.requires,
    recommends: r.recommends,
    platforms: r.platforms,
    isPublished: r.is_published,
    installPrice: Number(r.install_price),
    monthlyPrice: Number(r.monthly_price),
    status: r.status,
    enabled: r.enabled ?? false,
    trialEndsAt: r.trial_ends_at,
    missingRequires: r.requires.filter((d) => !activos.has(d)),
  }))
}
