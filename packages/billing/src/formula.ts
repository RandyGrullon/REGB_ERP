import {
  fromCents,
  roundBankers,
  toCents,
  type Cents,
  type ModuleCategory,
  type TenantTier,
} from '@regb/core'
import { CATEGORY_RANK, moduleCategoryPricing } from './module-pricing.js'
import { TIER_PLANS } from './tiers.js'
import { DISCOUNT_LABELS, DISCOUNT_RATES, type DiscountKind } from './discounts.js'
import type {
  ActiveModuleInput,
  InstallationCharge,
  InstallationInput,
  InvoiceLine,
  InvoiceResult,
  MonthlyInput,
} from './types.js'

/**
 * Motor de precios — §6.4 del documento maestro, "la ley" segun el agente
 * regb-billing. Logica pura: nada de red, nada de Supabase. El caller (Edge
 * Function o REGB Control) es quien persiste `invoices.lines`.
 */

const sumCents = (values: Cents[]): Cents => values.reduce((a, b) => (a + b) as Cents, toCents(0))

/** cents * factor, redondeado bancario a centavo entero — nunca float suelto. */
function scaleCents(cents: Cents, factor: number): Cents {
  return roundBankers(cents * factor, 0) as Cents
}

function resolveInstallPrice(mod: ActiveModuleInput, tier: TenantTier): Cents {
  return (
    mod.priceOverrideCents?.installCents ?? moduleCategoryPricing(mod.category, tier).installCents
  )
}

function resolveMonthlyPrice(mod: ActiveModuleInput, tier: TenantTier): Cents {
  return (
    mod.priceOverrideCents?.monthlyCents ?? moduleCategoryPricing(mod.category, tier).monthlyCents
  )
}

/**
 * Los modulos incluidos en el tier se descuentan tomando los mas caros
 * primero: el cliente siempre gana en el redondeo. Como el orden por
 * categoria es monotonico en instalacion y mensualidad (§6.3), un solo
 * calculo de "incluidos" sirve para las dos facturas.
 */
function splitIncluded<T extends { category: ModuleCategory }>(
  modules: T[],
  includedCount: number,
): { included: T[]; billable: T[] } {
  if (includedCount <= 0) return { included: [], billable: [...modules] }

  const ranked = modules
    .map((mod, index) => ({ mod, index, rank: CATEGORY_RANK[mod.category] }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)

  const includedIndices = new Set(ranked.slice(0, includedCount).map((r) => r.index))
  const included: T[] = []
  const billable: T[] = []
  modules.forEach((mod, index) =>
    includedIndices.has(index) ? included.push(mod) : billable.push(mod),
  )
  return { included, billable }
}

/**
 * Cierra la factura: descuento, cargos de una sola vez, impuesto.
 *
 * El descuento se calcula SOLO sobre lo recurrente (`inputLines`); los
 * cargos de una vez entran despues, sin descuento, y el impuesto va sobre
 * todo. `subtotalCents` es la suma de todas las lineas antes del
 * descuento, como siempre.
 */
function finalize(
  inputLines: InvoiceLine[],
  discount: DiscountKind,
  taxRate: number,
  oneTime: InvoiceLine[] = [],
): InvoiceResult {
  const recurringCents = sumCents(inputLines.map((l) => l.amountCents))
  const oneTimeCents = sumCents(oneTime.map((l) => l.amountCents))
  const subtotalCents = (recurringCents + oneTimeCents) as Cents
  const discountRate = DISCOUNT_RATES[discount]
  const discountCents = discountRate > 0 ? scaleCents(recurringCents, discountRate) : toCents(0)

  const lines = [...inputLines]
  if (discountRate > 0) {
    lines.push({
      label: 'Descuento',
      detail: `${DISCOUNT_LABELS[discount]} -${Math.round(discountRate * 100)}%`,
      amountCents: -discountCents as Cents,
    })
  }
  lines.push(...oneTime)

  const afterDiscount = (subtotalCents - discountCents) as Cents
  const taxCents = taxRate > 0 ? scaleCents(afterDiscount, taxRate) : toCents(0)
  if (taxCents > 0) {
    lines.push({ label: 'ITBIS', detail: `${Math.round(taxRate * 100)}%`, amountCents: taxCents })
  }

  const totalCents = (afterDiscount + taxCents) as Cents
  return {
    lines,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
    total: roundBankers(fromCents(totalCents), 2),
  }
}

export function calculateInstallation(input: InstallationInput): InvoiceResult {
  const plan = TIER_PLANS[input.tier]
  const paid = input.activeModules.filter((m) => !m.trial)
  const { billable } = splitIncluded(paid, plan.includedModules)

  const lines: InvoiceLine[] = [
    { label: 'Instalacion', detail: `Tier ${input.tier}`, amountCents: plan.installPriceCents },
  ]

  if (paid.length > 0) {
    lines.push({
      label: 'Instalacion de modulos',
      detail: `${billable.length} de ${paid.length} facturables (${plan.includedModules} incluidos en el tier)`,
      amountCents: sumCents(billable.map((m) => resolveInstallPrice(m, input.tier))),
    })
  }

  if (input.customIntegrationsCents) {
    lines.push({ label: 'Integraciones a medida', amountCents: input.customIntegrationsCents })
  }

  return finalize(lines, input.discount ?? 'none', 0)
}

export function calculateMonthly(input: MonthlyInput): InvoiceResult {
  const plan = TIER_PLANS[input.tier]
  const paid = input.activeModules.filter((m) => !m.trial)
  const trialCount = input.activeModules.length - paid.length
  const { billable } = splitIncluded(paid, plan.includedModules)

  const lines: InvoiceLine[] = [
    { label: 'Base mensual', detail: `Tier ${input.tier}`, amountCents: plan.monthlyBaseCents },
  ]

  if (paid.length > 0) {
    lines.push({
      label: 'Modulos activos',
      detail: `${billable.length} de ${paid.length} facturables (${plan.includedModules} incluidos en el tier)`,
      amountCents: sumCents(billable.map((m) => resolveMonthlyPrice(m, input.tier))),
    })
  }
  if (trialCount > 0) {
    lines.push({
      label: 'Modulos en prueba',
      detail: `${trialCount}, US$0 mientras dure el trial`,
      amountCents: toCents(0),
    })
  }

  const extraUsers = Math.max(0, input.usage.activeUsers - plan.includedUsers)
  if (extraUsers > 0) {
    lines.push({
      label: 'Usuarios extra',
      detail: `${input.usage.activeUsers} usuarios, ${plan.includedUsers} incluidos -> ${extraUsers} x`,
      amountCents: scaleCents(plan.extraUserCents, extraUsers),
    })
  }

  const extraBranches = Math.max(0, input.usage.branches - plan.includedBranches)
  if (extraBranches > 0) {
    lines.push({
      label: 'Sucursales extra',
      detail: `${input.usage.branches}, ${plan.includedBranches} incluidas -> ${extraBranches} x`,
      amountCents: scaleCents(plan.extraBranchCents, extraBranches),
    })
  }

  const extraCompanies = Math.max(0, input.usage.companies - plan.includedCompanies)
  if (extraCompanies > 0) {
    lines.push({
      label: 'Empresas extra',
      detail: `${input.usage.companies}, ${plan.includedCompanies} incluidas -> ${extraCompanies} x`,
      amountCents: scaleCents(plan.extraCompanyCents, extraCompanies),
    })
  }

  const extraStorage = Math.max(0, input.usage.storageGb - plan.includedStorageGb)
  if (extraStorage > 0) {
    lines.push({
      label: 'Storage extra',
      detail: `${input.usage.storageGb} GB, ${plan.includedStorageGb} GB incluido -> ${extraStorage} GB`,
      amountCents: scaleCents(plan.extraStorageGbCents, extraStorage),
    })
  }

  const extraTransactions = Math.max(0, input.usage.transactions - plan.includedTransactions)
  if (extraTransactions > 0 && plan.extraTransactionBlockCents > 0) {
    const blocks = Math.ceil(extraTransactions / plan.extraTransactionBlockSize)
    lines.push({
      label: 'Transacciones extra',
      detail: `${extraTransactions} sobre ${plan.includedTransactions} incluidas -> ${blocks} bloque(s) de ${plan.extraTransactionBlockSize}`,
      amountCents: scaleCents(plan.extraTransactionBlockCents, blocks),
    })
  }

  for (const metered of input.metered ?? []) {
    if (metered.quantity <= 0) continue
    lines.push({
      label: `Consumo medido: ${metered.metric}`,
      detail: `${metered.quantity} x`,
      amountCents: scaleCents(metered.unitPriceCents, metered.quantity),
    })
  }

  return finalize(lines, input.discount ?? 'none', input.taxRate ?? 0, input.oneTimeCharges ?? [])
}

/**
 * Cuanto cuesta instalar los modulos `pendingIds`, recien activados.
 *
 * Se decide sobre TODOS los modulos pagados y activos del cliente, igual
 * que la cotizacion de instalacion: los que caen dentro de los incluidos
 * del tier (los mas caros primero) se instalan a US$0. Un modulo en
 * prueba no cuenta ni se cobra: su instalacion llega cuando pase a activo.
 *
 * Cada modulo se cobra una vez: quien llama guarda lo que ya se facturo y
 * solo pasa aqui lo que falta.
 */
export function installationChargesFor(
  tier: TenantTier,
  activeModules: ActiveModuleInput[],
  pendingIds: string[],
): InstallationCharge[] {
  const plan = TIER_PLANS[tier]
  const paid = activeModules.filter((m) => !m.trial)
  const { included } = splitIncluded(paid, plan.includedModules)
  const incluidos = new Set(included.map((m) => m.moduleId))
  const pendientes = new Set(pendingIds)

  return paid
    .filter((m) => pendientes.has(m.moduleId))
    .map((m) =>
      incluidos.has(m.moduleId)
        ? { moduleId: m.moduleId, amountCents: toCents(0), included: true }
        : { moduleId: m.moduleId, amountCents: resolveInstallPrice(m, tier), included: false },
    )
}
