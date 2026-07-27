import { toCents, type Cents, type TenantTier } from '@regb/core'

/**
 * Configuracion de cada tier — §6.1 y §6.2 del documento maestro.
 */
export interface TierPlan {
  tier: TenantTier
  installPriceCents: Cents
  monthlyBaseCents: Cents
  includedUsers: number
  includedBranches: number
  includedCompanies: number
  includedStorageGb: number
  includedTransactions: number
  /** Modulos "a eleccion" que el tier regala ademas de los 15 core (§6.1). */
  includedModules: number
  extraUserCents: Cents
  extraBranchCents: Cents
  extraCompanyCents: Cents
  extraStorageGbCents: Cents
  extraTransactionBlockCents: Cents
  extraTransactionBlockSize: number
}

const UNLIMITED = Number.POSITIVE_INFINITY

export const TIER_PLANS: Record<TenantTier, TierPlan> = {
  pyme: {
    tier: 'pyme',
    installPriceCents: toCents(500),
    monthlyBaseCents: toCents(79),
    includedUsers: 5,
    includedBranches: 1,
    includedCompanies: 1,
    includedStorageGb: 10,
    includedTransactions: 5000,
    includedModules: 0,
    extraUserCents: toCents(9),
    extraBranchCents: toCents(25),
    extraCompanyCents: toCents(0),
    extraStorageGbCents: toCents(0.5),
    extraTransactionBlockCents: toCents(5),
    extraTransactionBlockSize: 1000,
  },
  mediano: {
    tier: 'mediano',
    installPriceCents: toCents(3500),
    monthlyBaseCents: toCents(399),
    includedUsers: 25,
    includedBranches: 5,
    includedCompanies: 3,
    includedStorageGb: 100,
    includedTransactions: 50000,
    includedModules: 5,
    extraUserCents: toCents(7),
    extraBranchCents: toCents(20),
    extraCompanyCents: toCents(90),
    extraStorageGbCents: toCents(0.4),
    extraTransactionBlockCents: toCents(3),
    extraTransactionBlockSize: 1000,
  },
  grande: {
    tier: 'grande',
    installPriceCents: toCents(15000),
    monthlyBaseCents: toCents(1500),
    includedUsers: 100,
    includedBranches: UNLIMITED,
    includedCompanies: UNLIMITED,
    includedStorageGb: 1000,
    includedTransactions: UNLIMITED,
    includedModules: 15,
    extraUserCents: toCents(5),
    extraBranchCents: toCents(0),
    extraCompanyCents: toCents(0),
    extraStorageGbCents: toCents(0.25),
    extraTransactionBlockCents: toCents(0),
    extraTransactionBlockSize: 1000,
  },
}
