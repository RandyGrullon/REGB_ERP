import type { Cents, ModuleCategory, TenantTier } from '@regb/core'
import type { DiscountKind } from './discounts.js'

export interface ActiveModuleInput {
  moduleId: string
  category: ModuleCategory
  /** Precio negociado (regla 5 del agente regb-billing): siempre gana sobre el catalogo. */
  priceOverrideCents?: {
    installCents?: Cents
    monthlyCents?: Cents
  }
  /**
   * En trial no se factura, pero SI se excluye del reparto de "modulos
   * incluidos" — no tiene sentido que un modulo gratis por prueba le quite
   * el descuento a uno que el cliente si esta pagando.
   */
  trial?: boolean
}

export interface InvoiceLine {
  label: string
  detail?: string
  amountCents: Cents
}

export interface InvoiceResult {
  lines: InvoiceLine[]
  subtotalCents: Cents
  discountCents: Cents
  taxCents: Cents
  totalCents: Cents
  /** Redondeado a 2 decimales (bancario) en el ultimo paso — listo para mostrar. */
  total: number
}

export interface UsageInput {
  activeUsers: number
  branches: number
  companies: number
  storageGb: number
  transactions: number
}

export interface MeteredConsumption {
  metric: string
  quantity: number
  unitPriceCents: Cents
}

export interface InstallationInput {
  tier: TenantTier
  activeModules: ActiveModuleInput[]
  customIntegrationsCents?: Cents
  discount?: DiscountKind
}

export interface MonthlyInput {
  tier: TenantTier
  activeModules: ActiveModuleInput[]
  usage: UsageInput
  metered?: MeteredConsumption[]
  discount?: DiscountKind
  taxRate?: number
}
