/**
 * PUERTA F1 (S7) — el bus de eventos.
 *
 * Verifica que los modulos puedan hablarse sin conocerse, que un modulo
 * apagado no reciba nada, y que un manejador caido reintente sin
 * martillear ni perderse en silencio.
 */
import { describe, expect, it } from 'vitest'
import {
  buildSubscriptions,
  MAX_ATTEMPTS,
  nextOutcome,
  patternMatches,
  resolveTargets,
  retryDelaySeconds,
  type Subscription,
} from './events.js'

describe('Coincidencia de patrones', () => {
  it('el tipo exacto coincide', () => {
    expect(patternMatches('sales.order.confirmed', 'sales.order.confirmed')).toBe(true)
  })

  it('`sales.order.*` cubre las acciones de esa entidad', () => {
    expect(patternMatches('sales.order.*', 'sales.order.confirmed')).toBe(true)
    expect(patternMatches('sales.order.*', 'sales.order.cancelled')).toBe(true)
  })

  it('`sales.order.*` NO cubre otra entidad del mismo modulo', () => {
    expect(patternMatches('sales.order.*', 'sales.invoice.paid')).toBe(false)
  })

  it('`sales.*` cubre todo el modulo', () => {
    expect(patternMatches('sales.*', 'sales.order.confirmed')).toBe(true)
    expect(patternMatches('sales.*', 'sales.invoice.paid')).toBe(true)
  })

  it('`*` cubre todo', () => {
    expect(patternMatches('*', 'cualquier.cosa.aqui')).toBe(true)
  })

  it('no confunde un prefijo parcial', () => {
    // `sales` no debe cubrir a `sales-orders`.
    expect(patternMatches('sales.*', 'sales-orders.line.added')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Resolucion de destinatarios', () => {
  const subs: Subscription[] = [
    { moduleId: 'inventory', pattern: 'sales.order.confirmed' },
    { moduleId: 'accounting', pattern: 'sales.*' },
    { moduleId: 'notifications', pattern: '*' },
    { moduleId: 'bi', pattern: 'sales.order.*' },
  ]

  const evento = { type: 'sales.order.confirmed', emitted_by: 'sales' }

  it('entrega a todos los suscriptores activos', () => {
    const activos = new Set(['sales', 'inventory', 'accounting', 'notifications', 'bi'])
    expect(resolveTargets(evento, subs, activos)).toEqual([
      'accounting',
      'bi',
      'inventory',
      'notifications',
    ])
  })

  it('un modulo APAGADO no recibe nada', () => {
    // El cliente desactivo inventario: sus manejadores no corren, igual
    // que sus tablas no se leen.
    const activos = new Set(['sales', 'accounting'])
    expect(resolveTargets(evento, subs, activos)).toEqual(['accounting'])
  })

  it('el emisor nunca se escucha a si mismo', () => {
    const propios: Subscription[] = [{ moduleId: 'sales', pattern: 'sales.*' }]
    const activos = new Set(['sales'])
    expect(resolveTargets(evento, propios, activos)).toEqual([])
  })

  it('sin suscriptores, el evento no va a ningun lado y no falla', () => {
    expect(resolveTargets(evento, [], new Set(['sales']))).toEqual([])
  })

  it('un modulo con dos patrones que coinciden recibe UNA sola vez', () => {
    const dobles: Subscription[] = [
      { moduleId: 'bi', pattern: 'sales.*' },
      { moduleId: 'bi', pattern: 'sales.order.confirmed' },
    ]
    expect(resolveTargets(evento, dobles, new Set(['sales', 'bi']))).toEqual(['bi'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Reintentos', () => {
  it('un despacho exitoso cierra el evento', () => {
    expect(nextOutcome({ attempts: 0 }, { ok: true })).toEqual({ action: 'done' })
  })

  it('un fallo reintenta con backoff exponencial', () => {
    const r = nextOutcome({ attempts: 0 }, { ok: false, error: 'timeout' })
    expect(r.action).toBe('retry')
    expect(r.action === 'retry' && r.delaySeconds).toBe(120)
  })

  it('el backoff crece pero tiene tope de 2 horas', () => {
    expect(retryDelaySeconds(0)).toBe(30)
    expect(retryDelaySeconds(1)).toBe(120)
    expect(retryDelaySeconds(2)).toBe(480)
    expect(retryDelaySeconds(3)).toBe(1920)
    expect(retryDelaySeconds(10)).toBe(7200) // tope
  })

  it('tras agotar los intentos va a dead-letter, no se pierde en silencio', () => {
    const r = nextOutcome({ attempts: MAX_ATTEMPTS - 1 }, { ok: false, error: 'sigue fallando' })
    expect(r.action).toBe('dead-letter')
    expect(r.action === 'dead-letter' && r.reason).toContain('sigue fallando')
  })

  it('el ultimo intento util todavia reintenta', () => {
    expect(nextOutcome({ attempts: MAX_ATTEMPTS - 2 }, { ok: false, error: 'x' }).action).toBe(
      'retry',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Indice de suscripciones', () => {
  it('se construye desde lo que cada manifest declara', () => {
    const subs = buildSubscriptions([
      {
        id: 'inventory',
        events: { listens: ['sales.order.confirmed', 'purchasing.receipt.posted'] },
      },
      { id: 'accounting', events: { listens: ['sales.*'] } },
      { id: 'products', events: { listens: [] } },
    ])

    expect(subs).toEqual([
      { moduleId: 'inventory', pattern: 'sales.order.confirmed' },
      { moduleId: 'inventory', pattern: 'purchasing.receipt.posted' },
      { moduleId: 'accounting', pattern: 'sales.*' },
    ])
  })

  it('el core no conoce ningun modulo: todo sale de los manifests', () => {
    // Con cero manifests, cero suscripciones. No hay nada cableado.
    expect(buildSubscriptions([])).toEqual([])
  })
})
