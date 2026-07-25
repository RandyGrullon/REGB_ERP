/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PUERTA F1 — La maquina de modulos
 *
 *  Verifica que activar un modulo sea un dato, no un despliegue:
 *   · insertar en tenant_modules lo hace aparecer
 *   · apagarlo lo hace desaparecer y la ruta devuelve 403
 *   · una dependencia opcional que falta degrada, no rompe
 *   · el core no sabe el nombre de ningun modulo
 * ═══════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest'
import type { Role } from '@regb/permissions'
import { defineModule, priceFor, type ModuleManifest } from './manifest.js'
import { canOpenRoute, hydrate, type TenantModule } from './registry.js'

const USER = '11111111-1111-1111-1111-111111111111'

// ── Modulos de prueba ──────────────────────────────────────────────────

const products = defineModule({
  id: 'products',
  name: 'Productos',
  category: 'core',
  version: '1.0.0',
  icon: 'Box',
  pricing: {
    install: { pyme: 0, mediano: 0, grande: 0 },
    monthly: { pyme: 0, mediano: 0, grande: 0 },
  },
  permissions: ['products.view', 'products.create'],
  routes: [{ path: '/products', label: 'Catalogo', perm: 'products.view' }],
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view'],
})

const inventory = defineModule({
  id: 'inventory',
  name: 'Inventario',
  category: 'standard',
  version: '1.4.0',
  icon: 'Package',
  pricing: {
    install: { pyme: 150, mediano: 600, grande: 1800 },
    monthly: { pyme: 19, mediano: 69, grande: 190 },
  },
  requires: ['products'],
  recommends: ['purchasing'],
  permissions: ['inventory.view', 'inventory.adjust', 'inventory.cost.view'],
  routes: [
    { path: '/inventory', label: 'Existencias', perm: 'inventory.view' },
    { path: '/inventory/adjust', label: 'Ajustes', perm: 'inventory.adjust' },
    { path: '/inventory/:id', label: 'Detalle', perm: 'inventory.view', hidden: true },
  ],
  dashboardWidgets: ['stock-alerts'],
  events: { emits: ['inventory.stock.low'], listens: ['sales.order.confirmed'] },
  platforms: { web: true, desktop: true, mobile: true },
  mobileScope: ['view', 'count'],
})

const payroll = defineModule({
  id: 'payroll',
  name: 'Nomina',
  category: 'advanced',
  version: '1.0.0',
  icon: 'Users',
  pricing: {
    install: { pyme: 400, mediano: 1500, grande: 4000 },
    monthly: { pyme: 45, mediano: 160, grande: 420 },
  },
  permissions: ['payroll.view', 'payroll.run'],
  routes: [{ path: '/payroll', label: 'Nomina', perm: 'payroll.view' }],
  // Nomina no corre en movil: no tiene sentido cerrar una nomina en el celular.
  platforms: { web: true, desktop: true, mobile: false },
})

const MANIFESTS = new Map<string, ModuleManifest>([
  ['products', products],
  ['inventory', inventory],
  ['payroll', payroll],
])

const live = (id: string): TenantModule => ({ moduleId: id, status: 'active', enabled: true })

const owner: Role = {
  id: 'r1',
  name: 'Owner',
  visibleModules: ['*'],
  permissions: { '*': true },
  scope: {},
}

const almacenista: Role = {
  id: 'r2',
  name: 'Almacenista',
  visibleModules: ['products', 'inventory'],
  permissions: {
    'products.view': true,
    'inventory.view': true,
    'inventory.adjust': true,
    'inventory.cost.view': false,
  },
  scope: {},
}

const base = { ctx: { role: owner, userId: USER }, platform: 'web' as const, manifests: MANIFESTS }

// ═══════════════════════════════════════════════════════════════════════
describe('Activar un modulo es un dato, no un despliegue', () => {
  it('un modulo licenciado aparece en el sidebar', () => {
    const r = hydrate({ ...base, tenantModules: [live('products'), live('inventory')] })
    expect(r.sidebar.map((s) => s.moduleId)).toEqual(['products', 'inventory'])
  })

  it('quitarlo de tenant_modules lo hace desaparecer', () => {
    const r = hydrate({ ...base, tenantModules: [live('products')] })
    expect(r.sidebar.map((s) => s.moduleId)).toEqual(['products'])
    expect(r.activeModules.has('inventory')).toBe(false)
  })

  it('apagarlo (enabled=false) lo desactiva sin perder la licencia', () => {
    const r = hydrate({
      ...base,
      tenantModules: [
        live('products'),
        { moduleId: 'inventory', status: 'active', enabled: false },
      ],
    })
    expect(r.activeModules.has('inventory')).toBe(false)
    expect(r.sidebar.find((s) => s.moduleId === 'inventory')).toBeUndefined()
  })

  it('un modulo suspendido por mora no corre', () => {
    const r = hydrate({
      ...base,
      tenantModules: [
        live('products'),
        { moduleId: 'inventory', status: 'suspended', enabled: true },
      ],
    })
    expect(r.activeModules.has('inventory')).toBe(false)
  })

  it('un modulo en prueba SI corre, y se marca como tal', () => {
    const now = new Date('2026-07-22T00:00:00Z')
    const r = hydrate({
      ...base,
      now,
      tenantModules: [
        live('products'),
        { moduleId: 'inventory', status: 'trial', enabled: true, trialEndsAt: '2026-07-31' },
      ],
    })
    const entry = r.sidebar.find((s) => s.moduleId === 'inventory')
    expect(entry?.isTrial).toBe(true)
    expect(entry?.trialDaysLeft).toBe(9)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Dependencias', () => {
  it('sin su dependencia obligatoria, el modulo no corre y se explica por que', () => {
    const r = hydrate({ ...base, tenantModules: [live('inventory')] })
    expect(r.activeModules.has('inventory')).toBe(false)
    expect(r.unavailable[0]?.reason).toContain('products')
  })

  it('sin una dependencia OPCIONAL, degrada pero funciona', () => {
    const r = hydrate({ ...base, tenantModules: [live('products'), live('inventory')] })
    const entry = r.sidebar.find((s) => s.moduleId === 'inventory')
    expect(entry).toBeDefined()
    expect(entry?.degraded).toBe(true)
    expect(entry?.missingOptional).toEqual(['purchasing'])
  })

  it('un modulo sin manifest en el bundle se reporta, no revienta', () => {
    const r = hydrate({ ...base, tenantModules: [live('products'), live('modulo-fantasma')] })
    expect(r.sidebar.map((s) => s.moduleId)).toEqual(['products'])
    expect(r.unavailable).toContainEqual({
      moduleId: 'modulo-fantasma',
      reason: 'El manifest no esta disponible en este bundle.',
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Licencia frente a renderizado — dos fronteras distintas', () => {
  /**
   * `activeModules` = lo que puede PINTARSE.
   * `licensedModules` = lo que el cliente PAGA, la misma frontera que
   * `auth.module_active()` en SQL.
   *
   * Confundirlas convierte un hueco de implementacion en un 403
   * inexplicable: el cliente compro el modulo, la UI aun no existe, y el
   * servidor le niega permisos que si tiene.
   */
  it('un modulo licenciado sin manifest cuenta como licenciado', () => {
    const r = hydrate({ ...base, tenantModules: [live('products'), live('rbac')] })
    expect(r.licensedModules.has('rbac')).toBe(true)
    expect(r.activeModules.has('rbac')).toBe(false)
  })

  it('un modulo que no corre en esta plataforma sigue estando licenciado', () => {
    const r = hydrate({ ...base, platform: 'mobile', tenantModules: [live('payroll')] })
    expect(r.licensedModules.has('payroll')).toBe(true)
    expect(r.activeModules.has('payroll')).toBe(false)
  })

  it('un modulo APAGADO no esta en ninguna de las dos', () => {
    const r = hydrate({
      ...base,
      tenantModules: [{ moduleId: 'products', status: 'active', enabled: false }],
    })
    expect(r.licensedModules.has('products')).toBe(false)
    expect(r.activeModules.has('products')).toBe(false)
  })

  it('un modulo suspendido por mora tampoco', () => {
    const r = hydrate({
      ...base,
      tenantModules: [{ moduleId: 'products', status: 'suspended', enabled: true }],
    })
    expect(r.licensedModules.has('products')).toBe(false)
  })

  it('las rutas siguen usando activeModules: sin manifest no hay que abrir', () => {
    const r = hydrate({ ...base, tenantModules: [live('products'), live('rbac')] })
    expect(canOpenRoute('/rbac', r, { role: owner, userId: USER })).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Plataformas', () => {
  it('nomina no aparece en movil aunque este licenciada', () => {
    const r = hydrate({ ...base, platform: 'mobile', tenantModules: [live('payroll')] })
    expect(r.activeModules.has('payroll')).toBe(false)
    expect(r.unavailable[0]?.reason).toContain('mobile')
  })

  it('la misma licencia si funciona en web', () => {
    const r = hydrate({ ...base, platform: 'web', tenantModules: [live('payroll')] })
    expect(r.activeModules.has('payroll')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Permisos y visibilidad', () => {
  it('el almacenista ve inventario pero no nomina', () => {
    const r = hydrate({
      ...base,
      ctx: { role: almacenista, userId: USER },
      tenantModules: [live('products'), live('inventory'), live('payroll')],
    })
    expect(r.sidebar.map((s) => s.moduleId).sort()).toEqual(['inventory', 'products'])
  })

  it('las rutas ocultas no salen en el sidebar pero si se registran', () => {
    const r = hydrate({ ...base, tenantModules: [live('products'), live('inventory')] })
    const inv = r.sidebar.find((s) => s.moduleId === 'inventory')
    expect(inv?.routes.map((x) => x.path)).toEqual(['/inventory', '/inventory/adjust'])
    // La ruta oculta existe para el guard del servidor.
    expect(r.routePermissions.get('/inventory/:id')).toBe('inventory.view')
  })

  it('la ruta de un modulo que el rol no ve devuelve 403, no datos', () => {
    const r = hydrate({
      ...base,
      ctx: { role: almacenista, userId: USER },
      tenantModules: [live('products'), live('inventory'), live('payroll')],
    })
    // Aunque adivine la URL.
    expect(canOpenRoute('/payroll', r, { role: almacenista, userId: USER })).toBe(false)
    expect(canOpenRoute('/inventory', r, { role: almacenista, userId: USER })).toBe(true)
  })

  it('una ruta inexistente nunca se abre', () => {
    const r = hydrate({ ...base, tenantModules: [live('products')] })
    expect(canOpenRoute('/no-existe', r, { role: owner, userId: USER })).toBe(false)
  })

  it('un modulo apagado cierra sus rutas aunque el rol tenga "*"', () => {
    const r = hydrate({
      ...base,
      tenantModules: [
        live('products'),
        { moduleId: 'inventory', status: 'active', enabled: false },
      ],
    })
    expect(canOpenRoute('/inventory', r, { role: owner, userId: USER })).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Orden y widgets', () => {
  it('el sidebar ordena por categoria y luego alfabeticamente', () => {
    const r = hydrate({
      ...base,
      tenantModules: [live('payroll'), live('inventory'), live('products')],
    })
    // core → standard → advanced
    expect(r.sidebar.map((s) => s.moduleId)).toEqual(['products', 'inventory', 'payroll'])
  })

  it('los widgets de dashboard salen de los modulos activos', () => {
    const r = hydrate({ ...base, tenantModules: [live('products'), live('inventory')] })
    expect(r.widgets).toEqual(['stock-alerts'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('El contrato del manifest', () => {
  it('rechaza un id que no sea kebab-case', () => {
    expect(() => defineModule({ ...inventory, id: 'SalesOrders' })).toThrow(/kebab-case/)
  })

  it('rechaza un modulo core con precio', () => {
    expect(() =>
      defineModule({
        ...products,
        pricing: {
          install: { pyme: 100, mediano: 100, grande: 100 },
          monthly: { pyme: 10, mediano: 10, grande: 10 },
        },
      }),
    ).toThrow(/incluidos en todos los planes/)
  })

  it('rechaza una ruta cuyo permiso no esta declarado', () => {
    expect(() =>
      defineModule({
        ...products,
        routes: [{ path: '/x', label: 'X', perm: 'products.inventado' }],
      }),
    ).toThrow(/no esta en permissions/)
  })

  it('rechaza soportar movil sin declarar mobileScope', () => {
    expect(() =>
      defineModule({
        ...products,
        platforms: { web: true, desktop: true, mobile: true },
        mobileScope: [],
      }),
    ).toThrow(/mobileScope/)
  })

  it('rechaza emitir eventos con prefijo de otro modulo', () => {
    expect(() =>
      defineModule({
        ...inventory,
        events: { emits: ['sales.order.confirmed'], listens: [] },
      }),
    ).toThrow(/solo emite eventos con su prefijo/)
  })

  it('rechaza un modulo sin permisos', () => {
    expect(() => defineModule({ ...products, permissions: [], routes: [] })).toThrow(/auditable/)
  })

  it('rechaza una version que no sea semantica', () => {
    expect(() => defineModule({ ...products, version: 'v1' })).toThrow(/semantico/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Precios por tier', () => {
  it('inventario cuesta distinto segun el tamano del cliente', () => {
    expect(priceFor(inventory, 'pyme')).toEqual({ install: 150, monthly: 19, perUser: 0 })
    expect(priceFor(inventory, 'mediano')).toEqual({ install: 600, monthly: 69, perUser: 0 })
    expect(priceFor(inventory, 'grande')).toEqual({ install: 1800, monthly: 190, perUser: 0 })
  })

  it('un modulo core es gratis en los tres tiers', () => {
    for (const tier of ['pyme', 'mediano', 'grande'] as const) {
      expect(priceFor(products, tier)).toEqual({ install: 0, monthly: 0, perUser: 0 })
    }
  })
})
