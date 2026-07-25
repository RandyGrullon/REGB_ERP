/**
 * ═══════════════════════════════════════════════════════════════════════
 *  El contrato de modulo
 *
 *  Un modulo declara TODO lo que necesita en su manifest. El core no sabe
 *  nada de el: lee este objeto y actua. Por eso agregar el modulo numero 93
 *  no obliga a tocar ni una linea del core (§2.2, §4.1).
 * ═══════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod'
import { moduleCategorySchema, type tenantTierSchema } from '@regb/core'

// ── Precios ────────────────────────────────────────────────────────────

const tierPricesSchema = z.object({
  pyme: z.number().nonnegative(),
  mediano: z.number().nonnegative(),
  grande: z.number().nonnegative(),
})

const meteredSchema = z.object({
  key: z.string(),
  included: z.number().nonnegative(),
  overageUnit: z.number().positive(),
  price: z.number().nonnegative(),
})

export const pricingSchema = z.object({
  install: tierPricesSchema,
  monthly: tierPricesSchema,
  perUser: tierPricesSchema.optional(),
  metered: z.array(meteredSchema).default([]),
})
export type ModulePricing = z.infer<typeof pricingSchema>

// ── Navegacion ─────────────────────────────────────────────────────────

export const routeSchema = z.object({
  path: z.string().startsWith('/'),
  label: z.string().min(1),
  /** Permiso necesario para ver la ruta. Se valida TAMBIEN en servidor. */
  perm: z.string().min(1),
  icon: z.string().optional(),
  /** Oculta del sidebar pero la ruta existe (detalles, edicion). */
  hidden: z.boolean().default(false),
})
export type ModuleRoute = z.infer<typeof routeSchema>

// ── El manifest ────────────────────────────────────────────────────────

export const manifestSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, 'El id va en kebab-case: "sales-orders", no "SalesOrders"'),
    name: z.string().min(1),
    description: z.string().default(''),
    icon: z.string().default('Package'),
    category: moduleCategorySchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Versionado semantico: 1.4.0'),

    pricing: pricingSchema,

    /** Sin estos, el modulo no puede activarse. */
    requires: z.array(z.string()).default([]),
    /** Sin estos funciona, pero con menos features (degradacion elegante). */
    recommends: z.array(z.string()).default([]),
    /** No pueden coexistir. */
    conflicts: z.array(z.string()).default([]),

    /** Todo permiso que el modulo expone. Lo que no este aqui, no existe. */
    permissions: z.array(z.string()).min(1, 'Un modulo sin permisos no es auditable'),

    routes: z.array(routeSchema).default([]),
    dashboardWidgets: z.array(z.string()).default([]),
    reports: z.array(z.string()).default([]),

    events: z
      .object({
        emits: z.array(z.string()).default([]),
        listens: z.array(z.string()).default([]),
      })
      .default({ emits: [], listens: [] }),

    platforms: z
      .object({ web: z.boolean(), desktop: z.boolean(), mobile: z.boolean() })
      .default({ web: true, desktop: true, mobile: true }),

    /** En movil solo estas acciones. El movil NO es el ERP completo (§13.5). */
    mobileScope: z.array(z.string()).default([]),
  })
  .superRefine((m, ctx) => {
    // Un modulo core es gratis, por definicion.
    if (m.category === 'core') {
      const cargos = [
        ...Object.values(m.pricing.install),
        ...Object.values(m.pricing.monthly),
      ].filter((v) => v > 0)
      if (cargos.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pricing'],
          message: 'Los modulos "core" van incluidos en todos los planes: su precio debe ser 0.',
        })
      }
    }

    // Toda ruta debe apoyarse en un permiso declarado.
    const declarados = new Set(m.permissions)
    for (const [i, r] of m.routes.entries()) {
      if (!declarados.has(r.perm)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['routes', i, 'perm'],
          message: `La ruta "${r.path}" exige "${r.perm}", que no esta en permissions[].`,
        })
      }
    }

    // Si dice soportar movil, tiene que decir QUE soporta.
    if (m.platforms.mobile && m.mobileScope.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mobileScope'],
        message:
          'Declara mobileScope: el movil es un subconjunto explicito, no una copia del ERP (§13.5).',
      })
    }

    // Un modulo no puede depender de si mismo ni entrar en conflicto consigo.
    if (m.requires.includes(m.id) || m.conflicts.includes(m.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requires'],
        message: 'Un modulo no puede referenciarse a si mismo.',
      })
    }

    // Un modulo emite eventos con su propio prefijo; escuchar es libre.
    for (const [i, e] of m.events.emits.entries()) {
      if (!e.startsWith(`${m.id}.`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['events', 'emits', i],
          message: `Un modulo solo emite eventos con su prefijo: "${m.id}.${e}".`,
        })
      }
    }
  })

export type ModuleManifest = z.infer<typeof manifestSchema>

/**
 * Declara un modulo. Valida el contrato al cargar, no en produccion.
 *
 * @example
 * export default defineModule({
 *   id: 'inventory',
 *   name: 'Inventario',
 *   category: 'standard',
 *   ...
 * })
 */
export function defineModule(input: unknown): ModuleManifest {
  const result = manifestSchema.safeParse(input)
  if (!result.success) {
    const detalle = result.error.issues
      .map((i) => `  · ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n')
    const id =
      typeof input === 'object' && input !== null && 'id' in input ? String(input.id) : '(sin id)'
    throw new Error(`Manifest invalido en el modulo "${id}":\n${detalle}`)
  }
  return result.data
}

/** Precio del modulo para un tier concreto. */
export function priceFor(
  manifest: ModuleManifest,
  tier: z.infer<typeof tenantTierSchema>,
): { install: number; monthly: number; perUser: number } {
  return {
    install: manifest.pricing.install[tier],
    monthly: manifest.pricing.monthly[tier],
    perUser: manifest.pricing.perUser?.[tier] ?? 0,
  }
}
