/**
 * Tests del manejo de dinero.
 *
 * El motor de facturacion (Fase 3) descansa en esto. Un centavo de error
 * por factura, multiplicado por 38 clientes y 12 meses, es una discusion
 * con un contador que no quieres tener.
 */
import { describe, expect, it } from 'vitest'
import {
  fromCents,
  nexusEventSchema,
  roundBankers,
  sessionSchema,
  toCents,
  WRITABLE_STATUSES,
} from './types.js'

describe('Dinero', () => {
  it('convierte a centavos sin arrastrar error de punto flotante', () => {
    expect(toCents(906.0)).toBe(90_600)
    expect(toCents(123.25)).toBe(12_325)
    // 0.1 + 0.2 = 0.30000000000000004 en binario. Aqui no.
    expect(toCents(0.1 + 0.2)).toBe(30)
  })

  it('ida y vuelta conserva el valor', () => {
    for (const v of [0, 0.01, 19, 123.25, 906, 3946.99, 74_400]) {
      expect(fromCents(toCents(v))).toBe(v)
    }
  })

  it('redondeo bancario: el .5 va al par, sin sesgo al alza', () => {
    expect(roundBankers(2.345, 2)).toBe(2.34) // 4 es par
    expect(roundBankers(2.355, 2)).toBe(2.36) // 6 es par
    expect(roundBankers(0.5, 0)).toBe(0)
    expect(roundBankers(1.5, 0)).toBe(2)
    expect(roundBankers(2.5, 0)).toBe(2)
    expect(roundBankers(3.5, 0)).toBe(4)
  })

  it('no altera valores que no estan en el punto medio', () => {
    expect(roundBankers(123.254, 2)).toBe(123.25)
    expect(roundBankers(123.256, 2)).toBe(123.26)
    expect(roundBankers(906, 2)).toBe(906)
  })

  it('sobrevive a la trampa del punto flotante', () => {
    // 2.345 NO existe en IEEE 754: el double real es 2.3450000000000002,
    // un pelo por ENCIMA del punto medio. Escalar da 234.50000000000003,
    // el `=== 0.5` falla y sin normalizar esto devolveria 2.35.
    expect(2.345 * 100).not.toBe(234.5)
    expect(roundBankers(2.345, 2)).toBe(2.34)

    // 2.355 en cambio si escala exacto: la regla del par actua directa.
    expect(2.355 * 100).toBe(235.5)
    expect(roundBankers(2.355, 2)).toBe(2.36)

    // Que un literal caiga a un lado u otro es imposible de predecir a ojo.
    // Por eso la logica de dinero vive en centavos enteros, no en floats.
    expect(toCents(2.345)).toBe(235)
  })

  it('el sesgo acumulado sobre muchos redondeos tiende a cero', () => {
    // Con Math.round, 1000 valores en .5 suman 500 de mas.
    let bancario = 0
    let ingenuo = 0
    for (let i = 0; i < 1000; i++) {
      bancario += roundBankers(i + 0.5, 0)
      ingenuo += Math.round(i + 0.5)
    }
    expect(ingenuo - bancario).toBe(500)
  })
})

describe('Sesion', () => {
  it('acepta una sesion valida de un usuario de tenant', () => {
    const s = sessionSchema.parse({
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'maria@distribuidora.do',
      tenantId: '22222222-2222-2222-2222-222222222222',
      roleId: '33333333-3333-3333-3333-333333333333',
      isProvider: false,
    })
    expect(s.branchIds).toEqual([])
    expect(s.isProvider).toBe(false)
  })

  it('un usuario del proveedor no necesita tenant', () => {
    const s = sessionSchema.parse({
      userId: '11111111-1111-1111-1111-111111111111',
      email: 'randy@nexus.do',
      tenantId: null,
      roleId: null,
      isProvider: true,
    })
    expect(s.isProvider).toBe(true)
  })

  it('rechaza un tenantId que no sea uuid', () => {
    expect(() =>
      sessionSchema.parse({
        userId: '11111111-1111-1111-1111-111111111111',
        email: 'x@y.do',
        tenantId: 'colmado-la-esperanza',
        roleId: null,
      }),
    ).toThrow()
  })
})

describe('Eventos entre modulos', () => {
  const base = {
    id: 1,
    tenantId: '22222222-2222-2222-2222-222222222222',
    payload: {},
    emittedBy: 'sales',
    correlationId: '33333333-3333-3333-3333-333333333333',
    emittedAt: '2026-07-22T10:00:00.000Z',
  }

  it('acepta el patron <modulo>.<entidad>.<accion>', () => {
    expect(nexusEventSchema.parse({ ...base, type: 'sales.order.confirmed' }).type).toBe(
      'sales.order.confirmed',
    )
    expect(nexusEventSchema.parse({ ...base, type: 'sales-orders.line.added' }).type).toBeTruthy()
  })

  it('rechaza un tipo sin las tres partes', () => {
    expect(() => nexusEventSchema.parse({ ...base, type: 'order.confirmed' })).toThrow()
    expect(() => nexusEventSchema.parse({ ...base, type: 'SalesOrderConfirmed' })).toThrow()
  })
})

describe('Estados del cliente', () => {
  it('en readonly y suspended no se escribe', () => {
    expect(WRITABLE_STATUSES).not.toContain('readonly')
    expect(WRITABLE_STATUSES).not.toContain('suspended')
    expect(WRITABLE_STATUSES).not.toContain('archived')
  })

  it('past_due todavia escribe: la mora avisa antes de bloquear', () => {
    // Dia 5 avisa, dia 10 banner, dia 15 solo lectura (§6.6).
    expect(WRITABLE_STATUSES).toContain('past_due')
  })
})
