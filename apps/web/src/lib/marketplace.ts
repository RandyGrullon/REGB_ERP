import 'server-only'

import { db } from './db'
import type { CatalogEntry, ModuleDetail } from './catalog'
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

/**
 * Ficha completa de un modulo (§12.3 → detalle).
 *
 * Devuelve `null` si el modulo no existe o no esta publicado: un cliente no
 * debe poder curiosear fichas de cosas que no vendemos todavia adivinando
 * la URL.
 */
export async function loadModuleDetail(
  moduleId: string,
  tenantId: string,
  tier: TenantTier,
): Promise<ModuleDetail | null> {
  const [row] = await db()<
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
      tagline: string | null
      problem: string | null
      features: { titulo: string; detalle: string }[]
      audience: string[]
      screens: { titulo: string; descripcion: string; mockup: string }[]
      faq: { p: string; r: string }[]
      setup_minutes: number | null
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
      mc.tagline, mc.problem, mc.features, mc.audience, mc.screens,
      mc.faq, mc.setup_minutes,
      mp.install_price, mp.monthly_price,
      tm.status, tm.enabled, tm.trial_ends_at
    from regb.module_catalog mc
    join regb.module_pricing mp
      on mp.module_id = mc.id and mp.tier = ${tier}::regb.tenant_tier
    left join regb.tenant_modules tm
      on tm.module_id = mc.id and tm.tenant_id = ${tenantId}
    where mc.id = ${moduleId}`

  if (!row) return null

  // Que dependencias le faltan al cliente, para avisarlo en la ficha.
  const activos = await db()<{ module_id: string }[]>`
    select module_id from regb.tenant_modules
    where tenant_id = ${tenantId} and status in ('active','trial') and enabled`
  const tiene = new Set(activos.map((a) => a.module_id))

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    icon: row.icon,
    category: row.category,
    requires: row.requires,
    recommends: row.recommends,
    platforms: row.platforms,
    isPublished: row.is_published,
    installPrice: Number(row.install_price),
    monthlyPrice: Number(row.monthly_price),
    status: row.status,
    enabled: row.enabled ?? false,
    trialEndsAt: row.trial_ends_at,
    missingRequires: row.requires.filter((d) => !tiene.has(d)),
    tagline: row.tagline ?? '',
    problem: row.problem ?? '',
    features: row.features,
    audience: row.audience,
    screens: row.screens,
    faq: row.faq,
    setupMinutes: row.setup_minutes,
    // Solo `invoice-capture` tiene consumo medido por ahora. Cuando haya
    // mas, esto sale del manifest en vez de estar aqui.
    metered: row.id === 'invoice-capture' ? { key: 'documento', included: 100, price: 0.04 } : null,
  }
}
