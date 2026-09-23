import { describe, expect, it } from 'vitest'
import { toCents } from '@regb/core'
import { calculateMonthly, installationChargesFor } from './formula.js'
import { invoiceDueDate, isoDate, PAYMENT_TERM_DAYS } from './collection.js'
import { billableStorageGb, taxRateForCountry } from './usage.js'
import type { ActiveModuleInput, UsageInput } from './types.js'

/**
 * Lo que la factura automatica de REGB Control dejaba fuera (defi-v1 §2.1,
 * analisis de flujo, hallazgo 9): impuesto por pais, storage medido,
 * vencimiento con plazo e instalacion de modulos una sola vez.
 */

const SIN_USO: UsageInput = {
  activeUsers: 0,
  branches: 0,
  companies: 0,
  storageGb: 0,
  transactions: 0,
}

describe('Impuesto por pais', () => {
  it('RD paga ITBIS 18 %', () => {
    expect(taxRateForCountry('DO')).toBe(0.18)
    expect(taxRateForCountry(' do ')).toBe(0.18)
  })

  it('fuera de RD no se inventa una tasa', () => {
    expect(taxRateForCountry('US')).toBe(0)
    expect(taxRateForCountry(null)).toBe(0)
  })
})

describe('Storage facturable', () => {
  it('GiB enteros hacia abajo: el cliente gana el redondeo', () => {
    expect(billableStorageGb(0)).toBe(0)
    expect(billableStorageGb(1024 ** 3 - 1)).toBe(0)
    expect(billableStorageGb(10.9 * 1024 ** 3)).toBe(10)
    expect(billableStorageGb(Number.NaN)).toBe(0)
  })
})

describe('Vencimiento', () => {
  it('emitida a mitad del periodo: 15 dias desde la emision, no nace vencida', () => {
    const vence = invoiceDueDate(new Date(2026, 8, 1), new Date(2026, 8, 23, 17, 30))
    expect(isoDate(vence)).toBe('2026-10-08')
  })

  it('emitida antes de que empiece el periodo: 15 dias dentro del periodo', () => {
    const vence = invoiceDueDate(new Date(2026, 9, 1), new Date(2026, 8, 28))
    expect(isoDate(vence)).toBe('2026-10-16')
    expect(PAYMENT_TERM_DAYS).toBe(15)
  })
})

describe('Cargos de una sola vez en la factura del mes', () => {
  const activeModules: ActiveModuleInput[] = [{ moduleId: 'inventory', category: 'standard' }]
  const instalacion = [{ label: 'Instalacion de modulos', amountCents: toCents(150) }]

  it('pagan ITBIS pero no llevan el descuento del ciclo', () => {
    const r = calculateMonthly({
      tier: 'pyme',
      activeModules,
      usage: SIN_USO,
      discount: 'annual',
      taxRate: 0.18,
      oneTimeCharges: instalacion,
    })
    // (79 + 19) x 0.85 = 83.30 recurrente, + 150 de instalacion = 233.30
    expect(r.discountCents).toBe(toCents(14.7))
    expect(r.subtotalCents).toBe(toCents(248))
    expect(r.taxCents).toBe(toCents(41.99))
    expect(r.total).toBe(275.29)
    expect(r.lines.map((l) => l.label)).toEqual([
      'Base mensual',
      'Modulos activos',
      'Descuento',
      'Instalacion de modulos',
      'ITBIS',
    ])
  })

  it('sin cargos de una vez la factura no cambia', () => {
    const a = calculateMonthly({ tier: 'pyme', activeModules, usage: SIN_USO, discount: 'annual' })
    const b = calculateMonthly({
      tier: 'pyme',
      activeModules,
      usage: SIN_USO,
      discount: 'annual',
      oneTimeCharges: [],
    })
    expect(b).toEqual(a)
  })
})

describe('Instalacion de modulos recien activados', () => {
  it('PYME no incluye modulos: cada uno paga su instalacion de categoria', () => {
    const cargos = installationChargesFor(
      'pyme',
      [
        { moduleId: 'inventory', category: 'standard' },
        { moduleId: 'payroll', category: 'advanced' },
      ],
      ['payroll'],
    )
    expect(cargos).toEqual([{ moduleId: 'payroll', amountCents: toCents(400), included: false }])
  })

  it('MEDIANO regala 5, los mas caros primero: lo incluido se registra a US$0', () => {
    const activos: ActiveModuleInput[] = [
      ...['a', 'b', 'c', 'd', 'e'].map((id) => ({ moduleId: id, category: 'advanced' as const })),
      { moduleId: 'pos', category: 'standard' },
    ]
    const cargos = installationChargesFor('mediano', activos, ['a', 'pos'])
    expect(cargos).toEqual([
      { moduleId: 'a', amountCents: toCents(0), included: true },
      { moduleId: 'pos', amountCents: toCents(600), included: false },
    ])
  })

  it('un modulo en prueba no se instala ni se cobra todavia', () => {
    const cargos = installationChargesFor(
      'pyme',
      [{ moduleId: 'inventory', category: 'standard', trial: true }],
      ['inventory'],
    )
    expect(cargos).toEqual([])
  })

  it('el precio negociado de instalacion gana', () => {
    const cargos = installationChargesFor(
      'pyme',
      [
        {
          moduleId: 'pos',
          category: 'standard',
          priceOverrideCents: { installCents: toCents(99) },
        },
      ],
      ['pos'],
    )
    expect(cargos[0]!.amountCents).toBe(toCents(99))
  })
})
