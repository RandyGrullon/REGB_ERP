import 'server-only'

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { asUser, db } from './db'
import {
  claveSeleccion,
  type CatalogEntry,
  type CotizacionMotor,
  type FacturaMotor,
  type ModuleDetail,
  type ModuleScreenshots,
  type SolicitudPendiente,
} from './catalog'
import {
  MODULE_CATEGORY_PRICING,
  TIER_PLANS,
  calculateMonthly,
  installationChargesFor,
  taxRateForCountry,
  type ActiveModuleInput,
  type DiscountKind,
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
 * Donde viven las capturas. `next dev` corre desde `apps/web`, pero un
 * script lanzado desde la raiz del monorepo tiene otro `cwd`: se prueban
 * las dos rutas antes de concluir que no hay capturas.
 */
const CARPETAS_CAPTURAS = [
  join(process.cwd(), 'public', 'marketplace'),
  join(process.cwd(), 'apps', 'web', 'public', 'marketplace'),
]

/**
 * Las capturas que existen, con su fecha de modificacion.
 *
 * Se lee el disco en el servidor para que el navegador no pida un 404 por
 * cada una de las 80 tarjetas cuando falta una captura: la tarjeta ya
 * llega sabiendo si pinta la imagen o el placeholder.
 */
async function capturasEnDisco(): Promise<Map<string, number>> {
  for (const dir of CARPETAS_CAPTURAS) {
    let archivos: string[]
    try {
      archivos = await readdir(dir)
    } catch {
      continue
    }
    const out = new Map<string, number>()
    await Promise.all(
      archivos
        .filter((a) => a.endsWith('.jpg'))
        .map(async (a) => {
          try {
            out.set(a, Math.floor((await stat(join(dir, a))).mtimeMs))
          } catch {
            // Se borro entre el readdir y el stat: simplemente no esta.
          }
        }),
    )
    return out
  }
  return new Map()
}

function capturasDe(
  id: string,
  enDisco: Map<string, number>,
): { hasScreenshot: boolean; screenshots: ModuleScreenshots } {
  const url = (archivo: string) => {
    const v = enDisco.get(archivo)
    return v === undefined ? null : `/marketplace/${archivo}?v=${v}`
  }
  const screenshots = { dark: url(`${id}.jpg`), light: url(`${id}-claro.jpg`) }
  return {
    hasScreenshot: screenshots.dark !== null || screenshots.light !== null,
    screenshots,
  }
}

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
      -- Una prueba vencida (0128) ya no se ve ni se cobra: aqui tampoco
      -- cuenta como activa. Mismo criterio que rls.module_active().
      case
        when tm.status = 'trial' and tm.trial_ends_at < current_date then 'trial_expired'
        else tm.status::text
      end as status,
      tm.enabled, tm.trial_ends_at
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
  const enDisco = await capturasEnDisco()

  return rows.map((r) => ({
    ...capturasDe(r.id, enDisco),
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
      -- Una prueba vencida (0128) ya no se ve ni se cobra: aqui tampoco
      -- cuenta como activa. Mismo criterio que rls.module_active().
      case
        when tm.status = 'trial' and tm.trial_ends_at < current_date then 'trial_expired'
        else tm.status::text
      end as status,
      tm.enabled, tm.trial_ends_at
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
    where tenant_id = ${tenantId} and enabled
      and (status = 'active'
           or (status = 'trial' and (trial_ends_at is null or trial_ends_at >= current_date)))`
  const tiene = new Set(activos.map((a) => a.module_id))

  return {
    ...capturasDe(row.id, await capturasEnDisco()),
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

/**
 * La solicitud de activacion que el cliente tiene abierta, si la tiene.
 *
 * Se lee con la RLS del usuario (`asUser`), igual que antes en la pagina:
 * el cliente solo ve las suyas. Hay a lo sumo una pendiente por cliente
 * (indice unico en la 0035), asi que `limit 1` no esconde nada.
 */
export async function loadSolicitudPendiente(
  userId: string,
  tenantId: string,
): Promise<SolicitudPendiente | null> {
  const [fila] = await asUser(
    userId,
    tenantId,
    async (tx) =>
      await tx<
        {
          modules: string[]
          created_at: string
          quoted_monthly: string
          quoted_install: string
          note: string | null
        }[]
      >`
        select modules, created_at::text, quoted_monthly, quoted_install, note
        from regb.activation_requests
        where tenant_id = ${tenantId} and status = 'pending'
        limit 1`,
  )
  if (!fila) return null
  return {
    modules: fila.modules,
    createdAt: fila.created_at,
    mensual: Number(fila.quoted_monthly),
    instalacion: Number(fila.quoted_install),
    nota: fila.note,
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Cotizacion con el motor de facturacion
// ─────────────────────────────────────────────────────────────────────

/** El mismo mapa que usa REGB Control para facturar (`lib/control.ts`). */
const CICLO_A_DESCUENTO: Record<string, DiscountKind> = {
  monthly: 'none',
  annual: 'annual',
  biennial: 'biennial',
  triennial: 'triennial',
}

/**
 * Uso por encima del plan: fuera de la cotizacion del marketplace.
 *
 * Usuarios, sucursales, empresas y storage extra NO cambian con los
 * modulos que se marcan, y leerlos es trabajo de la facturacion de REGB
 * Control (otro frente). Se cotiza con uso cero y la pantalla lo dice:
 * "lo que pase de lo que trae tu plan se cobra aparte".
 */
const SIN_USO_EXTRA: UsageInput = {
  activeUsers: 0,
  branches: 0,
  companies: 0,
  storageGb: 0,
  transactions: 0,
}

/** Lo que hace falta del cliente para cotizar; se lee una vez por pantalla. */
export interface BaseCotizacion {
  tier: TenantTier
  ciclo: string
  descuento: DiscountKind
  impuesto: number
  /** Modulos de pago que ya tiene (sin core), en el formato del motor. */
  actuales: ActiveModuleInput[]
  /** Todo lo que tiene encendido o en prueba viva, core incluido. */
  tiene: Set<string>
  catalogo: Map<string, { category: ModuleCategory; publicado: boolean }>
}

export async function cargarBaseCotizacion(tenantId: string): Promise<BaseCotizacion | null> {
  const sql = db()
  const [t] = await sql<
    { tier: TenantTier; country: string | null; billing_cycle: string | null }[]
  >`
    select t.tier, t.country, s.billing_cycle
    from regb.tenants t
    left join regb.subscriptions s on s.tenant_id = t.id and s.cancel_at is null
    where t.id = ${tenantId}
    limit 1`
  if (!t) return null

  // Prueba viva = con fecha futura o sin fecha, el mismo criterio que
  // `rls.module_active()` (0128). Una prueba vencida ya no se cotiza.
  const filas = await sql<
    {
      id: string
      category: ModuleCategory
      is_published: boolean
      estado: 'active' | 'trial' | null
      price_override: string | null
    }[]
  >`
    select mc.id, mc.category, mc.is_published,
           case
             when tm.enabled and tm.status = 'active' then 'active'
             when tm.enabled and tm.status = 'trial'
                  and (tm.trial_ends_at is null or tm.trial_ends_at >= current_date) then 'trial'
           end as estado,
           tm.price_override::text as price_override
    from regb.module_catalog mc
    left join regb.tenant_modules tm on tm.module_id = mc.id and tm.tenant_id = ${tenantId}`

  const ciclo = t.billing_cycle ?? 'monthly'
  return {
    tier: t.tier,
    ciclo,
    descuento: CICLO_A_DESCUENTO[ciclo] ?? 'none',
    impuesto: taxRateForCountry(t.country),
    // Mismo formato que `toEngineModules` de REGB Control: core fuera
    // (es gratis y solo ensucia el desglose) y el precio negociado gana.
    actuales: filas
      .filter((f) => f.estado !== null && f.category !== 'core')
      .map((f) => ({
        moduleId: f.id,
        category: f.category,
        trial: f.estado === 'trial',
        ...(f.price_override !== null
          ? { priceOverrideCents: { monthlyCents: toCents(Number(f.price_override)) } }
          : {}),
      })),
    tiene: new Set(filas.filter((f) => f.estado !== null).map((f) => f.id)),
    catalogo: new Map(
      filas.map((f) => [f.id, { category: f.category, publicado: f.is_published }]),
    ),
  }
}

const aDolares = (c: Cents): number => roundBankers(fromCents(c), 2)

function factura(r: InvoiceResult): FacturaMotor {
  return {
    lineas: r.lines.map((l) => ({
      concepto: l.label,
      detalle: l.detail ?? null,
      monto: aDolares(l.amountCents),
    })),
    subtotal: aDolares(r.subtotalCents),
    descuento: aDolares(r.discountCents),
    impuesto: aDolares(r.taxCents),
    total: r.total,
  }
}

/**
 * Cotiza una seleccion con `calculateMonthly`, sin tocar la base.
 *
 * Lo que no se puede comprar se descarta aqui y no en el navegador: lo
 * que no existe, lo no publicado, lo que ya tiene, lo que viene en el
 * plan y lo que su tier no ofrece (enterprise fuera de "grande"; el
 * motor lanzaria error). Los nuevos entran como pagados: la prueba de 14
 * dias es gratis, pero lo que se le ensena es lo que pagara despues.
 */
export function cotizarConBase(base: BaseCotizacion, seleccion: Iterable<string>): CotizacionMotor {
  const pedidos = [...new Set(seleccion)]
  const nuevos: ActiveModuleInput[] = []
  for (const id of pedidos) {
    const c = base.catalogo.get(id)
    if (!c || !c.publicado || c.category === 'core' || base.tiene.has(id)) continue
    if (MODULE_CATEGORY_PRICING[c.category][base.tier] === null) continue
    nuevos.push({ moduleId: id, category: c.category })
  }

  const comun = { tier: base.tier, usage: SIN_USO_EXTRA, taxRate: base.impuesto }
  const todos = [...base.actuales, ...nuevos]
  const hoy = calculateMonthly({ ...comun, activeModules: base.actuales, discount: base.descuento })
  const con = calculateMonthly({ ...comun, activeModules: todos, discount: base.descuento })

  const anual =
    base.descuento === 'none'
      ? calculateMonthly({ ...comun, activeModules: todos, discount: 'annual' })
      : null

  const hayPruebas = base.actuales.some((m) => m.trial)
  const trasPruebas = hayPruebas
    ? calculateMonthly({
        ...comun,
        activeModules: base.actuales.map((m) => ({ ...m, trial: false })),
        discount: base.descuento,
      }).total
    : null

  const instalacion = installationChargesFor(
    base.tier,
    todos,
    nuevos.map((m) => m.moduleId),
  ).map((c) => ({ moduleId: c.moduleId, monto: aDolares(c.amountCents), incluida: c.included }))

  const plan = TIER_PLANS[base.tier]
  return {
    clave: claveSeleccion(pedidos),
    modulos: nuevos.map((m) => m.moduleId),
    hoy: factura(hoy),
    conSeleccion: factura(con),
    aumento: roundBankers(con.total - hoy.total, 2),
    instalacion,
    instalacionTotal: roundBankers(
      instalacion.reduce((s, c) => s + c.monto, 0),
      2,
    ),
    anual: anual
      ? { total: anual.total, ahorroAlAno: roundBankers((con.total - anual.total) * 12, 2) }
      : null,
    trasPruebas,
    plan: {
      ciclo: base.ciclo,
      impuesto: base.impuesto,
      modulosIncluidos: plan.includedModules,
      usuariosIncluidos: plan.includedUsers,
      sucursalesIncluidas: Number.isFinite(plan.includedBranches) ? plan.includedBranches : null,
    },
  }
}

/** Atajo para quien cotiza una sola vez (la accion del simulador, la solicitud). */
export async function cotizarConMotor(
  tenantId: string,
  seleccion: Iterable<string>,
): Promise<CotizacionMotor | null> {
  const base = await cargarBaseCotizacion(tenantId)
  return base ? cotizarConBase(base, seleccion) : null
}
