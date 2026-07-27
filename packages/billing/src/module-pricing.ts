import { toCents, type Cents, type ModuleCategory, type TenantTier } from '@regb/core'

export interface ModuleCategoryPricing {
  installCents: Cents
  monthlyCents: Cents
}

/**
 * Orden de "cuan caro es" cada categoria. Monotonico en ambas dimensiones
 * (instalacion y mensual) para los tres tiers — ver §6.3 — asi que un solo
 * orden por categoria sirve para decidir que modulos son los "mas caros"
 * sin importar si se esta prorrateando instalacion o mensualidad.
 */
export const CATEGORY_RANK: Record<ModuleCategory, number> = {
  core: 0,
  standard: 1,
  advanced: 2,
  vertical: 3,
  enterprise: 4,
}

/** §6.3 — matriz de precios por categoria x tier. `null` = no se ofrece en ese tier. */
export const MODULE_CATEGORY_PRICING: Record<
  ModuleCategory,
  Record<TenantTier, ModuleCategoryPricing | null>
> = {
  core: {
    pyme: { installCents: toCents(0), monthlyCents: toCents(0) },
    mediano: { installCents: toCents(0), monthlyCents: toCents(0) },
    grande: { installCents: toCents(0), monthlyCents: toCents(0) },
  },
  standard: {
    pyme: { installCents: toCents(150), monthlyCents: toCents(19) },
    mediano: { installCents: toCents(600), monthlyCents: toCents(69) },
    grande: { installCents: toCents(1800), monthlyCents: toCents(190) },
  },
  advanced: {
    pyme: { installCents: toCents(400), monthlyCents: toCents(45) },
    mediano: { installCents: toCents(1500), monthlyCents: toCents(160) },
    grande: { installCents: toCents(4000), monthlyCents: toCents(420) },
  },
  vertical: {
    pyme: { installCents: toCents(600), monthlyCents: toCents(59) },
    mediano: { installCents: toCents(2200), monthlyCents: toCents(210) },
    grande: { installCents: toCents(6000), monthlyCents: toCents(550) },
  },
  enterprise: {
    pyme: null,
    mediano: null,
    grande: { installCents: toCents(12000), monthlyCents: toCents(900) },
  },
}

export function moduleCategoryPricing(
  category: ModuleCategory,
  tier: TenantTier,
): ModuleCategoryPricing {
  const pricing = MODULE_CATEGORY_PRICING[category][tier]
  if (!pricing) {
    throw new Error(
      `El modulo de categoria "${category}" no esta disponible en el tier "${tier}" (§6.3).`,
    )
  }
  return pricing
}
