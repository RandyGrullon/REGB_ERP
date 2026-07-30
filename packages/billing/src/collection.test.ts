import { describe, expect, it } from 'vitest'
import {
  CHARGE_SCHEDULE_DAYS,
  MAX_CHARGE_ATTEMPTS,
  chargeAttemptDate,
  chargeIdempotencyKey,
  isoDate,
  monthlyPeriod,
} from './collection.js'

describe('calendario de cobro (regla 8: dias 1, 3, 7, 14)', () => {
  const due = new Date(2026, 7, 12) // 12 ago 2026

  it('el intento 1 es el dia del vencimiento', () => {
    expect(isoDate(chargeAttemptDate(due, 1)!)).toBe('2026-08-12')
  })

  it('los reintentos caen en los dias 1, 3, 7 y 14', () => {
    expect(isoDate(chargeAttemptDate(due, 2)!)).toBe('2026-08-13')
    expect(isoDate(chargeAttemptDate(due, 3)!)).toBe('2026-08-15')
    expect(isoDate(chargeAttemptDate(due, 4)!)).toBe('2026-08-19')
    expect(isoDate(chargeAttemptDate(due, 5)!)).toBe('2026-08-26')
  })

  it('tras el ultimo intento devuelve null: escala a dunning, no sigue cobrando', () => {
    expect(chargeAttemptDate(due, MAX_CHARGE_ATTEMPTS + 1)).toBeNull()
    expect(CHARGE_SCHEDULE_DAYS).toHaveLength(MAX_CHARGE_ATTEMPTS)
  })

  it('cruza fin de mes sin perderse', () => {
    const finDeMes = new Date(2026, 0, 25) // 25 ene + 14 = 8 feb
    expect(isoDate(chargeAttemptDate(finDeMes, 5)!)).toBe('2026-02-08')
  })
})

describe('clave de idempotencia', () => {
  it('es determinista: mismo intento, misma clave', () => {
    expect(chargeIdempotencyKey('REGB-2026-00007', 2)).toBe('REGB-2026-00007:attempt-2')
    expect(chargeIdempotencyKey('REGB-2026-00007', 2)).toBe(
      chargeIdempotencyKey('REGB-2026-00007', 2),
    )
  })

  it('cambia entre intentos distintos', () => {
    expect(chargeIdempotencyKey('REGB-2026-00007', 1)).not.toBe(
      chargeIdempotencyKey('REGB-2026-00007', 2),
    )
  })
})

describe('periodo mensual', () => {
  it('devuelve primer y ultimo dia del mes', () => {
    const { start, end } = monthlyPeriod(new Date(2026, 6, 29))
    expect(isoDate(start)).toBe('2026-07-01')
    expect(isoDate(end)).toBe('2026-07-31')
  })

  it('febrero bisiesto', () => {
    const { end } = monthlyPeriod(new Date(2028, 1, 10))
    expect(isoDate(end)).toBe('2028-02-29')
  })
})
