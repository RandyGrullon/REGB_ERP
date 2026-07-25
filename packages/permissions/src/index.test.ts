/**
 * Tests del evaluador de permisos.
 *
 * Los casos salen de los roles reales de §8.2 del documento maestro:
 * el vendedor que no ve costos, el cajero atado a su caja, el auditor
 * que lee todo pero no toca nada.
 */
import { describe, expect, it } from 'vitest'
import { can, matchingPatterns, moduleVisible, type EvaluationContext, type Role } from './index.js'

const USER = '11111111-1111-1111-1111-111111111111'
const OTRO = '22222222-2222-2222-2222-222222222222'
const SUCURSAL_SD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const SUCURSAL_STI = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const ctx = (role: Role, modules: string[], extra: Partial<EvaluationContext> = {}) =>
  ({
    role,
    activeModules: new Set(modules),
    userId: USER,
    ...extra,
  }) satisfies EvaluationContext

// ── Roles de §8.2 ──────────────────────────────────────────────────────

const owner: Role = {
  id: 'r1',
  name: 'Owner',
  visibleModules: ['*'],
  permissions: { '*': true },
  scope: {},
}

const vendedor: Role = {
  id: 'r2',
  name: 'Vendedor',
  visibleModules: ['crm', 'quotes', 'sales-orders', 'pos'],
  permissions: {
    'crm.*': true,
    'quotes.create': true,
    'quotes.edit': true,
    'quotes.approve': false,
    'sales-orders.create': true,
    'inventory.view': true,
    'inventory.cost.view': false,
  },
  scope: { own_only: true, max_amount: 50_000 },
}

const cajero: Role = {
  id: 'r3',
  name: 'Cajero',
  visibleModules: ['pos'],
  permissions: { 'pos.sell': true, 'pos.shift.open': true, 'pos.void': false },
  scope: { branches: [SUCURSAL_SD] },
}

const auditor: Role = {
  id: 'r4',
  name: 'Auditor',
  visibleModules: ['*'],
  permissions: { '*.view': true, '*.export': true },
  scope: { read_only: true },
}

// ═══════════════════════════════════════════════════════════════════════
describe('matchingPatterns', () => {
  it('va de lo especifico a lo general', () => {
    expect(matchingPatterns('inventory.cost.view')).toEqual([
      'inventory.cost.view',
      'inventory.cost.*',
      'inventory.*',
      '*.view',
      '*',
    ])
  })

  it('maneja acciones de un solo nivel', () => {
    expect(matchingPatterns('login')).toEqual(['login', '*'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Licencia del modulo — se comprueba primero', () => {
  it('un modulo no licenciado se niega aunque el rol sea Owner', () => {
    const d = can('inventory.view', { module: 'inventory' }, ctx(owner, ['crm']))
    expect(d.allowed).toBe(false)
    expect(d.allowed === false && d.reason).toBe('module-not-licensed')
  })

  it('el Owner si puede cuando el modulo esta activo', () => {
    expect(can('inventory.view', { module: 'inventory' }, ctx(owner, ['inventory'])).allowed).toBe(
      true,
    )
  })

  it('no revela si ademas faltaba permiso: el motivo es siempre la licencia', () => {
    // Evita filtrar por el mensaje de error que el modulo existe.
    const d = can('payroll.view', { module: 'payroll' }, ctx(vendedor, ['crm']))
    expect(d.allowed === false && d.reason).toBe('module-not-licensed')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('La denegacion siempre gana', () => {
  it('una denegacion explicita vence a un comodin que concede', () => {
    const rol: Role = {
      ...vendedor,
      permissions: { '*': true, 'quotes.approve': false },
    }
    const d = can('quotes.approve', { module: 'quotes' }, ctx(rol, ['quotes']))
    expect(d.allowed).toBe(false)
    expect(d.allowed === false && d.reason).toBe('explicitly-denied')
  })

  it('el vendedor NO ve costos aunque tenga inventory.view', () => {
    const c = ctx(vendedor, ['inventory'])
    expect(can('inventory.view', { module: 'inventory' }, c).allowed).toBe(true)
    expect(can('inventory.cost.view', { module: 'inventory' }, c).allowed).toBe(false)
  })

  it('el cajero no puede anular ventas', () => {
    const d = can('pos.void', { module: 'pos' }, ctx(cajero, ['pos']))
    expect(d.allowed === false && d.reason).toBe('explicitly-denied')
  })

  it('una denegacion en un comodin superior tumba una concesion especifica', () => {
    const rol: Role = { ...vendedor, permissions: { 'payroll.view': true, 'payroll.*': false } }
    const d = can('payroll.view', { module: 'payroll' }, ctx(rol, ['payroll']))
    expect(d.allowed === false && d.reason).toBe('explicitly-denied')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Comodines', () => {
  it('`crm.*` concede cualquier accion de crm', () => {
    const c = ctx(vendedor, ['crm'])
    expect(can('crm.create', { module: 'crm' }, c).allowed).toBe(true)
    expect(can('crm.delete', { module: 'crm' }, c).allowed).toBe(true)
  })

  it('`*.view` del auditor concede ver en cualquier modulo', () => {
    expect(can('payroll.view', { module: 'payroll' }, ctx(auditor, ['payroll'])).allowed).toBe(true)
  })

  it('sin permiso ni comodin que aplique, se niega', () => {
    const d = can('accounting.post', { module: 'accounting' }, ctx(vendedor, ['accounting']))
    expect(d.allowed === false && d.reason).toBe('no-permission')
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Alcance ABAC', () => {
  it('own_only: el vendedor solo toca lo suyo', () => {
    const c = ctx(vendedor, ['quotes'])
    expect(can('quotes.edit', { module: 'quotes', ownerId: USER }, c).allowed).toBe(true)

    const d = can('quotes.edit', { module: 'quotes', ownerId: OTRO }, c)
    expect(d.allowed === false && d.reason).toBe('not-owner')
  })

  it('max_amount: el vendedor no pasa de 50,000', () => {
    const c = ctx(vendedor, ['quotes'])
    expect(can('quotes.create', { module: 'quotes', amount: 49_999 }, c).allowed).toBe(true)
    expect(can('quotes.create', { module: 'quotes', amount: 50_000 }, c).allowed).toBe(true)

    const d = can('quotes.create', { module: 'quotes', amount: 50_001 }, c)
    expect(d.allowed === false && d.reason).toBe('amount-exceeded')
  })

  it('branches: el cajero solo opera en su sucursal', () => {
    const c = ctx(cajero, ['pos'])
    expect(can('pos.sell', { module: 'pos', branchId: SUCURSAL_SD }, c).allowed).toBe(true)

    const d = can('pos.sell', { module: 'pos', branchId: SUCURSAL_STI }, c)
    expect(d.allowed === false && d.reason).toBe('out-of-branch')
  })

  it('read_only: el auditor lee y exporta, pero no escribe', () => {
    const c = ctx(auditor, ['accounting'])
    expect(can('accounting.view', { module: 'accounting' }, c).allowed).toBe(true)
    expect(can('accounting.export', { module: 'accounting' }, c).allowed).toBe(true)

    const rol: Role = { ...auditor, permissions: { '*': true }, scope: { read_only: true } }
    const d = can('accounting.post', { module: 'accounting' }, ctx(rol, ['accounting']))
    expect(d.allowed === false && d.reason).toBe('read-only')
  })

  it('hours: fuera del horario se niega', () => {
    const rol: Role = { ...vendedor, scope: { hours: '07:00-19:00' } }
    const dentro = ctx(rol, ['quotes'], { minutesOfDay: 10 * 60 })
    const fuera = ctx(rol, ['quotes'], { minutesOfDay: 22 * 60 })

    expect(can('quotes.create', { module: 'quotes' }, dentro).allowed).toBe(true)
    const d = can('quotes.create', { module: 'quotes' }, fuera)
    expect(d.allowed === false && d.reason).toBe('outside-hours')
  })

  it('hours: un turno nocturno cruza la medianoche', () => {
    const rol: Role = { ...vendedor, scope: { hours: '22:00-06:00' } }
    const medianoche = ctx(rol, ['quotes'], { minutesOfDay: 2 * 60 })
    const mediodia = ctx(rol, ['quotes'], { minutesOfDay: 12 * 60 })

    expect(can('quotes.create', { module: 'quotes' }, medianoche).allowed).toBe(true)

    const d = can('quotes.create', { module: 'quotes' }, mediodia)
    expect(d.allowed === false && d.reason).toBe('outside-hours')
  })

  it('sin datos del recurso, el alcance no bloquea de mas', () => {
    // Un listado general no trae branchId ni ownerId: no debe romperse.
    expect(can('quotes.create', { module: 'quotes' }, ctx(vendedor, ['quotes'])).allowed).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Visibilidad en el sidebar', () => {
  it('un modulo no licenciado nunca se ve, ni con visibleModules ["*"]', () => {
    expect(moduleVisible('payroll', ctx(owner, ['crm']))).toBe(false)
  })

  it('el vendedor no ve contabilidad aunque el cliente la tenga', () => {
    expect(moduleVisible('accounting', ctx(vendedor, ['accounting', 'crm']))).toBe(false)
    expect(moduleVisible('crm', ctx(vendedor, ['accounting', 'crm']))).toBe(true)
  })

  it('["*"] muestra todo lo licenciado', () => {
    const c = ctx(owner, ['crm', 'accounting', 'payroll'])
    expect(moduleVisible('payroll', c)).toBe(true)
  })

  it('ocultar del sidebar NO concede ni quita permisos', () => {
    // El cajero no ve 'inventory' en el sidebar...
    expect(moduleVisible('inventory', ctx(cajero, ['pos', 'inventory']))).toBe(false)
    // ...y tampoco puede actuar sobre el si adivina la URL.
    expect(
      can('inventory.adjust', { module: 'inventory' }, ctx(cajero, ['pos', 'inventory'])).allowed,
    ).toBe(false)
  })
})
