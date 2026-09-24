import 'server-only'

import { db } from './db'
import {
  billableStorageGb,
  calculateInstallation,
  calculateMonthly,
  installationChargesFor,
  taxRateForCountry,
  type ActiveModuleInput,
  type DiscountKind,
  type InstallationCharge,
  type InvoiceLine,
  type InvoiceResult,
  type UsageInput,
} from '@regb/billing'
import {
  fromCents,
  roundBankers,
  toCents,
  type Cents,
  type ModuleCategory,
  type TenantTier,
} from '@regb/core'

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
 *
 * Y es la MISMA cotizacion que factura `generateMonthlyInvoices()`: lo que
 * el panel ensena como "proxima factura" es, linea por linea, lo que se
 * guarda en `invoices.lines`. Hasta 0128 las dos cotizaban con uso cero y
 * sin ITBIS (defi-v1 §2.1): REGB cobraba de menos a todos sus clientes.
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
  /** Lo que se le cobra cada mes, ITBIS incluido. */
  monthlyTotal: number
  /** La mensualidad sin impuesto: lo que es ingreso de REGB. Es lo que suma el MRR. */
  monthlyNet: number
}

export interface ControlOverview {
  mrr: number
  clients: ControlClient[]
  byTier: { tier: TenantTier; mrr: number; count: number }[]
}

export interface TenantRow {
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
  /** ISO alfa-2. Decide el impuesto (`taxRateForCountry`). */
  country: string
  /** Membresias activas: las personas que entran al ERP. */
  active_users: number
  /** Sucursales activas y no borradas. */
  branches: number
  /** Empresas (RNC) no borradas. */
  companies: number
  /** Bytes en `files` fuera de la papelera. Texto: es bigint. */
  storage_bytes: string
}

interface ModuleRow {
  tenant_id: string
  module_id: string
  category: ModuleCategory
  name: string
  status: string
  price_override: string | null
  activated_at: string
  trial_ends_at: string | null
}

/**
 * Clientes con lo que hace falta para cotizarlos: modulos vivos, uso
 * medido e instalaciones pendientes.
 *
 * Lo que se mide y de donde:
 *  - usuarios: membresias `is_active` (una por persona y cliente);
 *  - sucursales: `is_active` y sin `deleted_at`;
 *  - empresas: sin `deleted_at`;
 *  - storage: `files.size_bytes` fuera de la papelera. La papelera no se
 *    puede vaciar (nunca hay borrado fisico), asi que cobrarla seria
 *    cobrar algo que el cliente no puede liberar. Los respaldos tampoco
 *    cuentan: son copia de lo que ya se cobra.
 *  - transacciones y consumos medidos: NADA los mide todavia
 *    (`regb.usage_meters` esta vacia y nadie la llena), asi que van en 0
 *    y la factura no los cobra. Esta dicho aqui y en el panel.
 *
 * Una prueba vencida no esta viva (0128): ni se ve ni se cotiza.
 */
export async function loadTenantsWithModules(slug?: string): Promise<{
  tenants: TenantRow[]
  modulesByTenant: Map<string, ModuleRow[]>
  pendingInstallByTenant: Map<string, string[]>
}> {
  const sql = db()
  const tenants = await sql<TenantRow[]>`
    select t.id, t.slug, t.legal_name, t.trade_name, t.tier, t.status,
           t.health_score, t.go_live_at::text,
           s.billing_cycle, s.renews_at::text,
           t.country,
           (select count(*)::int from public.memberships m
             where m.tenant_id = t.id and m.is_active) as active_users,
           (select count(*)::int from public.branches b
             where b.tenant_id = t.id and b.is_active and b.deleted_at is null) as branches,
           (select count(*)::int from public.companies c
             where c.tenant_id = t.id and c.deleted_at is null) as companies,
           (select coalesce(sum(f.size_bytes), 0)::text from public.files f
             where f.tenant_id = t.id and f.deleted_at is null) as storage_bytes
    from regb.tenants t
    left join regb.subscriptions s on s.tenant_id = t.id and s.cancel_at is null
    where t.status <> 'archived' and (${slug ?? null}::text is null or t.slug = ${slug ?? null})
    order by t.legal_name`

  if (tenants.length === 0) {
    return { tenants, modulesByTenant: new Map(), pendingInstallByTenant: new Map() }
  }

  const ids = tenants.map((t) => t.id)
  const mods = await sql<ModuleRow[]>`
    select tm.tenant_id, tm.module_id, mc.category, mc.name, tm.status,
           tm.price_override::text, tm.activated_at::text, tm.trial_ends_at::text
    from regb.tenant_modules tm
    join regb.module_catalog mc on mc.id = tm.module_id
    where tm.tenant_id = any(${ids}) and tm.enabled
      and (tm.status = 'active'
           or (tm.status = 'trial' and tm.trial_ends_at >= current_date))
    order by (mc.category = 'core'), mc.category, mc.name`

  const modulesByTenant = new Map<string, ModuleRow[]>()
  for (const m of mods) {
    const list = modulesByTenant.get(m.tenant_id) ?? []
    list.push(m)
    modulesByTenant.set(m.tenant_id, list)
  }

  const pendientes = await sql<{ tenant_id: string; module_id: string }[]>`
    select tenant_id, module_id from regb.module_installation_charges
    where tenant_id = any(${ids}) and amount is null
    order by module_id`
  const pendingInstallByTenant = new Map<string, string[]>()
  for (const p of pendientes) {
    pendingInstallByTenant.set(p.tenant_id, [
      ...(pendingInstallByTenant.get(p.tenant_id) ?? []),
      p.module_id,
    ])
  }

  return { tenants, modulesByTenant, pendingInstallByTenant }
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

export interface Quotes {
  /** Cotizacion de instalacion de todo lo activo: referencia comercial. */
  installation: InvoiceResult
  /** La mensualidad recurrente: plan, modulos, uso, descuento e ITBIS. */
  monthly: InvoiceResult
  /**
   * La PROXIMA factura: la mensualidad mas la instalacion de lo que se
   * activo y aun no se cobro. Es exactamente lo que factura
   * `generateMonthlyInvoices()`. Sin instalaciones pendientes es igual a
   * `monthly`.
   */
  invoice: InvoiceResult
  usage: UsageInput
  taxRate: number
  /** Instalaciones pendientes con su precio; quien factura las marca. */
  installationCharges: InstallationCharge[]
}

/** El uso medido del cliente, en la forma que espera el motor. */
export function usageOf(tenant: TenantRow): UsageInput {
  return {
    activeUsers: Number(tenant.active_users),
    branches: Number(tenant.branches),
    companies: Number(tenant.companies),
    storageGb: billableStorageGb(Number(tenant.storage_bytes)),
    // Nadie mide transacciones todavia: 0 y dicho (ver loadTenantsWithModules).
    transactions: 0,
  }
}

const usd = (cents: Cents) =>
  `US$ ${fromCents(cents).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Hasta cuantos modulos se nombran uno por uno en la linea de instalacion. */
const NOMBRADOS_MAX = 8

/**
 * La linea de instalacion de la factura, o nada si no hay pendientes.
 *
 * Se escribe con NOMBRES del catalogo: la lee el cliente en su factura y
 * el proveedor en la ficha, y "bank-rec US$1500.00 · accounting..." no le
 * dice nada a ninguno de los dos. Con muchos modulos se agrupa por precio:
 * el detalle por modulo ya queda en `module_installation_charges`, con su
 * monto y su factura, asi que la factura sigue siendo reproducible.
 */
function lineaDeInstalacion(
  cargos: InstallationCharge[],
  nombre: (id: string) => string,
): InvoiceLine[] {
  if (cargos.length === 0) return []
  const cobrados = cargos.filter((c) => !c.included)
  const incluidos = cargos.filter((c) => c.included)

  let partes: string[]
  if (cobrados.length <= NOMBRADOS_MAX) {
    partes = cobrados.map((c) => `${nombre(c.moduleId)} ${usd(c.amountCents)}`)
  } else {
    const porPrecio = new Map<number, number>()
    for (const c of cobrados) porPrecio.set(c.amountCents, (porPrecio.get(c.amountCents) ?? 0) + 1)
    partes = [...porPrecio.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([monto, n]) => `${n} módulos a ${usd(monto as Cents)}`)
  }
  if (incluidos.length > 0) {
    partes.push(
      incluidos.length <= NOMBRADOS_MAX
        ? `${incluidos.map((c) => nombre(c.moduleId)).join(', ')} sin costo (incluidos en el plan)`
        : `${incluidos.length} módulos sin costo (incluidos en el plan)`,
    )
  }
  return [
    {
      label: 'Instalación de módulos',
      detail: `Una sola vez: ${partes.join(' · ')}`,
      amountCents: cobrados.reduce((a, c) => a + c.amountCents, 0) as Cents,
    },
  ]
}

export function quoteTenant(
  tenant: TenantRow,
  rows: ModuleRow[],
  pendingInstall: string[] = [],
): Quotes {
  const activeModules = toEngineModules(rows)
  const discount = CYCLE_TO_DISCOUNT[tenant.billing_cycle ?? 'monthly'] ?? 'none'
  const usage = usageOf(tenant)
  const taxRate = taxRateForCountry(tenant.country)
  const installationCharges = installationChargesFor(tenant.tier, activeModules, pendingInstall)
  const base = { tier: tenant.tier, activeModules, usage, discount, taxRate }
  const monthly = calculateMonthly(base)
  const nombres = new Map(rows.map((r) => [r.module_id, r.name]))
  const nombre = (id: string) => nombres.get(id) ?? id
  return {
    installation: calculateInstallation({ tier: tenant.tier, activeModules }),
    monthly,
    invoice:
      installationCharges.length > 0
        ? calculateMonthly({
            ...base,
            oneTimeCharges: lineaDeInstalacion(installationCharges, nombre),
          })
        : monthly,
    usage,
    taxRate,
    installationCharges,
  }
}

/** Mensualidad sin impuesto, en dolares: lo que suma el MRR. */
const neto = (r: InvoiceResult) => roundBankers(fromCents((r.totalCents - r.taxCents) as Cents), 2)

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
      monthlyNet: neto(monthly),
    }
  })

  // El MRR va SIN ITBIS: el impuesto se cobra para la DGII, no es ingreso.
  const suma = (cs: ControlClient[]) =>
    roundBankers(
      cs.reduce((a, c) => a + c.monthlyNet, 0),
      2,
    )
  const byTier = (['pyme', 'mediano', 'grande'] as const)
    .map((tier) => {
      const own = clients.filter((c) => c.tier === tier)
      return { tier, mrr: suma(own), count: own.length }
    })
    .filter((g) => g.count > 0)

  return { mrr: suma(clients), clients, byTier }
}

export interface ClientDetail {
  client: ControlClient
  monthly: InvoiceResult
  /** La proxima factura, linea por linea igual a la que se va a emitir. */
  invoice: InvoiceResult
  installation: InvoiceResult
  usage: UsageInput
  taxRate: number
  /** Modulos activados cuya instalacion entra en la proxima factura, por su nombre. */
  pendingInstall: string[]
  /**
   * Pruebas que vencieron en los ultimos 60 dias. Ya no se ven ni se
   * cotizan (0128), pero son las ventas por cerrar: sin esta lista el
   * proveedor no tenia desde donde pasarlas a pago.
   */
  expiredTrials: { moduleId: string; name: string; endedOn: string }[]
  modules: {
    moduleId: string
    name: string
    category: ModuleCategory
    status: string
    activatedAt: string
    /** Fin de la prueba (solo en `trial`). */
    trialEndsAt: string | null
    priceOverride: number | null
  }[]
}

export async function loadClientDetail(slug: string): Promise<ClientDetail | null> {
  const { tenants, modulesByTenant, pendingInstallByTenant } = await loadTenantsWithModules(slug)
  const tenant = tenants[0]
  if (!tenant) return null

  const rows = modulesByTenant.get(tenant.id) ?? []
  const pendingInstall = pendingInstallByTenant.get(tenant.id) ?? []
  const { installation, monthly, invoice, usage, taxRate } = quoteTenant(
    tenant,
    rows,
    pendingInstall,
  )
  const paid = rows.filter((r) => r.category !== 'core')
  const nombre = new Map(rows.map((r) => [r.module_id, r.name]))

  const expiredTrials = await db()<{ moduleId: string; name: string; endedOn: string }[]>`
    select tm.module_id as "moduleId", mc.name, tm.trial_ends_at::text as "endedOn"
    from regb.tenant_modules tm
    join regb.module_catalog mc on mc.id = tm.module_id
    where tm.tenant_id = ${tenant.id} and tm.status = 'trial'
      and tm.trial_ends_at < current_date
      and tm.trial_ends_at >= current_date - 60
    order by tm.trial_ends_at desc`

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
      monthlyNet: neto(monthly),
    },
    monthly,
    invoice,
    installation,
    usage,
    taxRate,
    pendingInstall: pendingInstall.map((id) => nombre.get(id) ?? id),
    expiredTrials,
    modules: rows.map((r) => ({
      moduleId: r.module_id,
      name: r.name,
      category: r.category,
      status: r.status,
      activatedAt: r.activated_at,
      trialEndsAt: r.trial_ends_at,
      priceOverride: r.price_override !== null ? Number(r.price_override) : null,
    })),
  }
}
