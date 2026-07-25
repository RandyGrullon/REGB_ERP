/**
 * Tipos base de REGB ERP.
 *
 * Este paquete es logica pura: no importa React, no habla con la red,
 * no conoce Supabase. Es lo que comparten web, desktop y movil (§15.2).
 */
import { z } from 'zod'

// ── Cliente ────────────────────────────────────────────────────────────

export const tenantTierSchema = z.enum(['pyme', 'mediano', 'grande'])
export type TenantTier = z.infer<typeof tenantTierSchema>

export const tenantStatusSchema = z.enum([
  'trial',
  'active',
  'past_due',
  'readonly',
  'suspended',
  'archived',
])
export type TenantStatus = z.infer<typeof tenantStatusSchema>

/** Estados en los que el cliente puede escribir. En `readonly` solo lee. */
export const WRITABLE_STATUSES: readonly TenantStatus[] = ['trial', 'active', 'past_due']

// ── Modulos ────────────────────────────────────────────────────────────

export const moduleCategorySchema = z.enum([
  'core',
  'standard',
  'advanced',
  'vertical',
  'enterprise',
])
export type ModuleCategory = z.infer<typeof moduleCategorySchema>

export const moduleStatusSchema = z.enum(['trial', 'active', 'suspended', 'archived'])
export type ModuleStatus = z.infer<typeof moduleStatusSchema>

export const platformSchema = z.enum(['web', 'desktop', 'mobile'])
export type Platform = z.infer<typeof platformSchema>

// ── Sesion ─────────────────────────────────────────────────────────────

/**
 * Lo que la app sabe del usuario actual.
 *
 * `tenantId` viene SIEMPRE del JWT (`app_metadata`). Nunca de un formulario,
 * un parametro de ruta ni una query string. Ver §10 y la regla de ESLint.
 */
export const sessionSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  tenantId: z.string().uuid().nullable(),
  roleId: z.string().uuid().nullable(),
  isProvider: z.boolean().default(false),
  branchIds: z.array(z.string().uuid()).default([]),
  companyIds: z.array(z.string().uuid()).default([]),
})
export type Session = z.infer<typeof sessionSchema>

// ── Eventos entre modulos ──────────────────────────────────────────────

/**
 * Un modulo nunca importa otro modulo. Se hablan por aqui (§4.3, §4.4).
 * El tipo sigue el patron `<modulo>.<entidad>.<accion>`.
 */
export const regbEventSchema = z.object({
  id: z.union([z.string(), z.number()]),
  tenantId: z.string().uuid(),
  type: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/, {
    message: 'El tipo debe ser <modulo>.<entidad>.<accion>, ej. sales.order.confirmed',
  }),
  payload: z.unknown(),
  emittedBy: z.string(),
  correlationId: z.string().uuid(),
  emittedAt: z.string().datetime(),
})
export type RegbEvent = z.infer<typeof regbEventSchema>

// ── Dinero ─────────────────────────────────────────────────────────────

/**
 * El dinero se maneja en centavos enteros dentro de la logica y se
 * presenta con 2 decimales. `numeric(12,2)` en la base; nunca `float`.
 * Ver §9 y el agente regb-billing.
 */
export type Cents = number & { readonly __brand: 'Cents' }

export const toCents = (amount: number): Cents => Math.round(amount * 100) as Cents
export const fromCents = (cents: Cents): number => cents / 100

/**
 * Redondeo bancario (half-to-even): evita el sesgo al alza de `Math.round`.
 *
 * TRAMPA DEL PUNTO FLOTANTE — leer antes de tocar esta funcion.
 *
 * `2.345` no existe en IEEE 754: el valor real almacenado es
 * 2.34500000000000019539..., un pelo POR ENCIMA del punto medio. Escalar
 * ingenuamente da 234.50000000000003, el `=== 0.5` nunca se cumple y la
 * regla del par jamas se aplica.
 *
 * Por eso normalizamos a 12 cifras significativas antes de decidir: es
 * suficiente para absorber el error de representacion y muy inferior a los
 * 15-17 digitos de precision de un `double`, asi que no introduce error
 * propio en los montos que maneja un ERP.
 *
 * Aun asi, la defensa de verdad es no pasar por aqui: la logica de dinero
 * trabaja en centavos enteros (`toCents`) y solo divide al presentar.
 */
export function roundBankers(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  const scaled = Number((value * factor).toPrecision(12))
  const floor = Math.floor(scaled)

  if (scaled - floor !== 0.5) return Math.round(scaled) / factor
  return (floor % 2 === 0 ? floor : floor + 1) / factor
}

export const currencySchema = z.enum(['DOP', 'USD', 'EUR'])
export type Currency = z.infer<typeof currencySchema>
