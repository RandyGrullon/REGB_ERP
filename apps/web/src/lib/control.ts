import 'server-only'

import { db } from './db'
import {
  calculateInstallation,
  calculateMonthly,
  type ActiveModuleInput,
  type DiscountKind,
  type InvoiceResult,
} from '@regb/billing'
import { toCents, type ModuleCategory, type TenantTier } from '@regb/core'

/**
 * Datos de REGB Control (§7, §12.4-12.5): el panel del propietario.
 *
 * Aqui se consulta como proveedor, POR ENCIMA de los tenants: es la unica
 * zona de la app donde eso es correcto, y por eso la ruta exige
 * `session.isProvider` antes de llegar a estas funciones.
 *
 * Los montos NO salen de columnas guardadas: cada cifra se calcula en el
 * momento con `@regb/billing` a partir de los modulos activos reales.
 * Asi el panel nunca miente aunque el cliente active algo hace 5 minutos.
 */

const CYCLE_TO_DISCOUNT: Record<string, DiscountKind> = {
  monthly: 'none',
  annual: 'annual',
  biennial: 'biennial',
  triennial: 'triennial',
}

export interface ControlClient {
  slug: string
  legalName: string
  tradeName: string
  tier: TenantTier
  status: string
  healthScore: number | null
  billingCycle: string
  renewsAt: string | null
  goLiveAt: string | null
  paidModules: number
  trialModules: number
  installTotal: number
  monthlyTotal: number
}

export interface ControlOverview {
  mrr: number
  clients: ControlClient[]
  byTier: { tier: TenantTier; mrr: number; count: number }[]
}

interface TenantRow {
  id: string
  slug: string
  legal_name: string
  trade_name: string | null
  tier: TenantTier
  status: string
  health_score: number | null
  go_live_at: string | null
  billing_cycle: string | null
  renews_at: string | null
}

interface ModuleRow {
  tenant_id: string
  module_id: string
  category: ModuleCategory
  name: string
  status: string
  price_override: string | null
  activated_at: string
}

async function loadTenantsWithModules(slug?: string): Promise<{
  tenants: TenantRow[]
  modulesByTenant: Map<string, ModuleRow[]>
}> {
  const sql = db()
  const tenants = await sql<TenantRow[]>`
    select t.id, t.slug, t.legal_name, t.trade_name, t.tier, t.status,
           t.health_score, t.go_live_at::text,
           s.billing_cycle, s.renews_at::text
    from regb.tenants t
    left join regb.subscriptions s on s.tenant_id = t.id and s.cancel_at is null
    where t.status <> 'archived' and (${slug ?? null}::text is null or t.slug = ${slug ?? null})
    order by t.legal_name`

  if (tenants.length === 0) return { tenants, modulesByTenant: new Map() }

  const ids = tenants.map((t) => t.id)
  const mods = await sql<ModuleRow[]>`
    select tm.tenant_id, tm.module_id, mc.category, mc.name, tm.status,
           tm.price_override::text, tm.activated_at::text
    from regb.tenant_modules tm
    join regb.module_catalog mc on mc.id = tm.module_id
    where tm.tenant_id = any(${ids}) and tm.enabled and tm.status in ('active', 'trial')
    order by (mc.category = 'core'), mc.category, mc.name`

  const modulesByTenant = new Map<string, ModuleRow[]>()
  for (const m of mods) {
    const list = modulesByTenant.get(m.tenant_id) ?? []
    list.push(m)
    modulesByTenant.set(m.tenant_id, list)
  }
  return { tenants, modulesByTenant }
}

/** Modulos de pago del tenant en el formato que espera el motor. Core queda fuera: es gratis en todos los tiers y solo ensucia el desglose. */
function toEngineModules(rows: ModuleRow[]): ActiveModuleInput[] {
  return rows
    .filter((r) => r.category !== 'core')
    .map((r) => ({
      moduleId: r.module_id,
      category: r.category,
      trial: r.status === 'trial',
      ...(r.price_override !== null
        ? { priceOverrideCents: { monthlyCents: toCents(Number(r.price_override)) } }
        : {}),
    }))
}

interface Quotes {
  installation: InvoiceResult
  monthly: InvoiceResult
}

function quoteTenant(tenant: TenantRow, rows: ModuleRow[]): Quotes {
  const activeModules = toEngineModules(rows)
  const discount = CYCLE_TO_DISCOUNT[tenant.billing_cycle ?? 'monthly'] ?? 'none'
  // Uso real (usuarios, storage, consumo) llega en F3 cuando el dispatcher
  // alimente usage_meters; mientras, el panel cotiza plan + modulos.
  const usage = { activeUsers: 0, branches: 0, companies: 0, storageGb: 0, transactions: 0 }
  return {
    installation: calculateInstallation({ tier: tenant.tier, activeModules }),
    monthly: calculateMonthly({ tier: tenant.tier, activeModules, usage, discount }),
  }
}

export async function loadControlOverview(): Promise<ControlOverview> {
  const { tenants, modulesByTenant } = await loadTenantsWithModules()

  const clients = tenants.map((t): ControlClient => {
    const rows = modulesByTenant.get(t.id) ?? []
    const { installation, monthly } = quoteTenant(t, rows)
    const paid = rows.filter((r) => r.category !== 'core')
    return {
      slug: t.slug,
      legalName: t.legal_name,
      tradeName: t.trade_name ?? t.legal_name,
      tier: t.tier,
      status: t.status,
      healthScore: t.health_score,
      billingCycle: t.billing_cycle ?? 'monthly',
      renewsAt: t.renews_at,
      goLiveAt: t.go_live_at,
      paidModules: paid.filter((r) => r.status === 'active').length,
      trialModules: paid.filter((r) => r.status === 'trial').length,
      installTotal: installation.total,
      monthlyTotal: monthly.total,
    }
  })

  const byTier = (['pyme', 'mediano', 'grande'] as const)
    .map((tier) => {
      const own = clients.filter((c) => c.tier === tier)
      return { tier, mrr: own.reduce((a, c) => a + c.monthlyTotal, 0), count: own.length }
    })
    .filter((g) => g.count > 0)

  return { mrr: clients.reduce((a, c) => a + c.monthlyTotal, 0), clients, byTier }
}

export interface ClientDetail {
  client: ControlClient
  monthly: InvoiceResult
  installation: InvoiceResult
  modules: {
    moduleId: string
    name: string
    category: ModuleCategory
    status: string
    activatedAt: string
    priceOverride: number | null
  }[]
}

export async function loadClientDetail(slug: string): Promise<ClientDetail | null> {
  const { tenants, modulesByTenant } = await loadTenantsWithModules(slug)
  const tenant = tenants[0]
  if (!tenant) return null

  const rows = modulesByTenant.get(tenant.id) ?? []
  const { installation, monthly } = quoteTenant(tenant, rows)
  const paid = rows.filter((r) => r.category !== 'core')

  return {
    client: {
      slug: tenant.slug,
      legalName: tenant.legal_name,
      tradeName: tenant.trade_name ?? tenant.legal_name,
      tier: tenant.tier,
      status: tenant.status,
      healthScore: tenant.health_score,
      billingCycle: tenant.billing_cycle ?? 'monthly',
      renewsAt: tenant.renews_at,
      goLiveAt: tenant.go_live_at,
      paidModules: paid.filter((r) => r.status === 'active').length,
      trialModules: paid.filter((r) => r.status === 'trial').length,
      installTotal: installation.total,
      monthlyTotal: monthly.total,
    },
    monthly,
    installation,
    modules: rows.map((r) => ({
      moduleId: r.module_id,
      name: r.name,
      category: r.category,
      status: r.status,
      activatedAt: r.activated_at,
      priceOverride: r.price_override !== null ? Number(r.price_override) : null,
    })),
  }
}
