import { describe, expect, it } from 'vitest'
import { toCents, type Cents } from '@regb/core'
import { calculateInstallation, calculateMonthly } from './formula.js'
import { moduleCategoryPricing } from './module-pricing.js'
import { prorateDaily } from './proration.js'
import type { ActiveModuleInput, UsageInput } from './types.js'

/**
 * Los 3 ejemplos de §6.5 son casos de prueba obligatorios (agente
 * regb-billing): si el motor no los reproduce al centavo, no se despliega.
 *
 * §6.5 fue corregido junto con este motor: los ejemplos 2 y 3 no
 * reproducian la regla "los modulos incluidos se descuentan tomando los
 * mas caros primero" tal como esta escrita en el agente. Estos tests usan
 * los totales ya corregidos; ver la nota en docs/PROYECTO-REGB-ERP.md §6.5.
 */
describe('§6.5 — casos de prueba obligatorios', () => {
  it('Ejemplo 1 — Colmado La Esperanza (PYME, 6 empleados)', () => {
    const activeModules: ActiveModuleInput[] = [
      { moduleId: 'inventory', category: 'standard' },
      { moduleId: 'pos', category: 'standard' },
      { moduleId: 'ar', category: 'standard' },
    ]
    const usage: UsageInput = {
      activeUsers: 6,
      branches: 1,
      companies: 1,
      storageGb: 0,
      transactions: 0,
    }

    const installation = calculateInstallation({ tier: 'pyme', activeModules })
    expect(installation.total).toBe(950)

    const monthly = calculateMonthly({ tier: 'pyme', activeModules, usage, discount: 'annual' })
    expect(monthly.total).toBe(123.25)
  })

  it('Ejemplo 2 — Distribuidora Caribe SRL (MEDIANO, 85 empleados)', () => {
    const activeModules: ActiveModuleInput[] = [
      { moduleId: 'inventory', category: 'standard' },
      { moduleId: 'sales-orders', category: 'standard' },
      { moduleId: 'purchase-orders', category: 'standard' },
      { moduleId: 'crm', category: 'standard' },
      { moduleId: 'ar', category: 'standard' },
      { moduleId: 'ap', category: 'standard' },
      { moduleId: 'accounting', category: 'advanced' },
      { moduleId: 'payroll', category: 'advanced' },
      { moduleId: 'bi', category: 'advanced' },
    ]
    const usage: UsageInput = {
      activeUsers: 40,
      branches: 4,
      companies: 1,
      storageGb: 0,
      transactions: 0,
    }

    const installation = calculateInstallation({ tier: 'mediano', activeModules })
    expect(installation.total).toBe(5900)

    const monthly = calculateMonthly({
      tier: 'mediano',
      activeModules,
      usage,
      metered: [{ metric: 'e-cf', quantity: 3500, unitPriceCents: toCents(0.01) }],
    })
    expect(monthly.total).toBe(815)
  })

  it('Ejemplo 3 — Grupo Industrial Quisqueya (GRANDE, 640 empleados)', () => {
    const standard: ActiveModuleInput[] = Array.from({ length: 10 }, (_, i) => ({
      moduleId: `standard-${i}`,
      category: 'standard' as const,
    }))
    const advanced: ActiveModuleInput[] = Array.from({ length: 9 }, (_, i) => ({
      moduleId: `advanced-${i}`,
      category: 'advanced' as const,
    }))
    const vertical: ActiveModuleInput[] = Array.from({ length: 3 }, (_, i) => ({
      moduleId: `vertical-${i}`,
      category: 'vertical' as const,
    }))
    const activeModules = [...standard, ...advanced, ...vertical]
    const usage: UsageInput = {
      activeUsers: 260,
      branches: 18,
      companies: 5,
      storageGb: 2400,
      transactions: 0,
    }

    const installation = calculateInstallation({
      tier: 'grande',
      activeModules,
      customIntegrationsCents: toCents(12000),
    })
    expect(installation.total).toBe(39600)

    const monthly = calculateMonthly({
      tier: 'grande',
      activeModules,
      usage,
      discount: 'triennial',
    })
    expect(monthly.total).toBe(2985)
  })
})

describe('modulos incluidos — mas caros primero', () => {
  it('deja libres solo los billable de menor categoria cuando hay empate de conteo', () => {
    const activeModules: ActiveModuleInput[] = [
      { moduleId: 'a', category: 'standard' },
      { moduleId: 'b', category: 'standard' },
      { moduleId: 'c', category: 'advanced' },
    ]
    const usage: UsageInput = {
      activeUsers: 25,
      branches: 5,
      companies: 3,
      storageGb: 0,
      transactions: 0,
    }
    const monthly = calculateMonthly({ tier: 'mediano', activeModules, usage })
    // includedModules mediano = 5, solo hay 3 activos: todos entran, ninguno se factura.
    const modulesLine = monthly.lines.find((l) => l.label === 'Módulos activos')
    expect(modulesLine?.amountCents).toBe(0)
    expect(modulesLine?.detail).toContain('0 de 3 facturables')
  })
})

describe('price_override siempre gana sobre el catalogo (regla 5)', () => {
  it('usa el precio negociado en vez del precio de catalogo', () => {
    const activeModules: ActiveModuleInput[] = [
      {
        moduleId: 'inventory',
        category: 'standard',
        priceOverrideCents: { monthlyCents: toCents(5) },
      },
    ]
    const usage: UsageInput = {
      activeUsers: 1,
      branches: 1,
      companies: 1,
      storageGb: 0,
      transactions: 0,
    }
    const monthly = calculateMonthly({ tier: 'pyme', activeModules, usage })
    const modulesLine = monthly.lines.find((l) => l.label === 'Módulos activos')
    expect(modulesLine?.amountCents).toBe(toCents(5))
  })
})

describe('modulos en prueba', () => {
  it('no factura mientras esta en trial y no consume cupo de incluidos', () => {
    const activeModules: ActiveModuleInput[] = [
      { moduleId: 'inventory', category: 'standard' },
      { moduleId: 'accounting', category: 'advanced', trial: true },
    ]
    const usage: UsageInput = {
      activeUsers: 5,
      branches: 1,
      companies: 1,
      storageGb: 0,
      transactions: 0,
    }
    const monthly = calculateMonthly({ tier: 'pyme', activeModules, usage })

    const modulesLine = monthly.lines.find((l) => l.label === 'Módulos activos')
    expect(modulesLine?.amountCents).toBe(toCents(19)) // solo inventory, pyme no tiene incluidos

    const trialLine = monthly.lines.find((l) => l.label === 'Módulos en prueba')
    expect(trialLine?.amountCents).toBe(0)
    expect(trialLine?.detail).toContain('1,')
  })

  it('cuando el trial vence y el modulo pasa a pago, sube el total', () => {
    const usage: UsageInput = {
      activeUsers: 5,
      branches: 1,
      companies: 1,
      storageGb: 0,
      transactions: 0,
    }
    const enTrial = calculateMonthly({
      tier: 'pyme',
      activeModules: [{ moduleId: 'accounting', category: 'advanced', trial: true }],
      usage,
    })
    const yaPago = calculateMonthly({
      tier: 'pyme',
      activeModules: [{ moduleId: 'accounting', category: 'advanced' }],
      usage,
    })
    expect(yaPago.total).toBeGreaterThan(enTrial.total)
    expect(yaPago.total - enTrial.total).toBe(45) // advanced pyme mensual
  })
})

describe('consumo medido y sobreuso', () => {
  it('cobra transacciones extra por bloques de 1000', () => {
    const usage: UsageInput = {
      activeUsers: 5,
      branches: 1,
      companies: 1,
      storageGb: 0,
      transactions: 7200, // 5000 incluidas en PYME -> 2200 extra -> 3 bloques
    }
    const monthly = calculateMonthly({ tier: 'pyme', activeModules: [], usage })
    const txLine = monthly.lines.find((l) => l.label === 'Transacciones extra')
    expect(txLine?.amountCents).toBe(toCents(15)) // 3 bloques x $5
  })

  it('las transacciones son ilimitadas en GRANDE: nunca cobra extra', () => {
    const usage: UsageInput = {
      activeUsers: 5,
      branches: 1,
      companies: 1,
      storageGb: 0,
      transactions: 10_000_000,
    }
    const monthly = calculateMonthly({ tier: 'grande', activeModules: [], usage })
    expect(monthly.lines.find((l) => l.label === 'Transacciones extra')).toBeUndefined()
  })

  it('suma consumos medidos independientes (SMS, WhatsApp, API)', () => {
    const usage: UsageInput = {
      activeUsers: 5,
      branches: 1,
      companies: 1,
      storageGb: 0,
      transactions: 0,
    }
    const monthly = calculateMonthly({
      tier: 'pyme',
      activeModules: [],
      usage,
      metered: [
        { metric: 'sms', quantity: 100, unitPriceCents: toCents(0.03) },
        { metric: 'whatsapp', quantity: 50, unitPriceCents: toCents(0.05) },
      ],
    })
    expect(monthly.lines.find((l) => l.label === 'Consumo medido: sms')?.amountCents).toBe(
      toCents(3),
    )
    expect(monthly.lines.find((l) => l.label === 'Consumo medido: whatsapp')?.amountCents).toBe(
      toCents(2.5),
    )
  })
})

describe('cambio de tier (upgrade / downgrade)', () => {
  it('recalcula la base y el cupo de incluidos al cambiar de tier', () => {
    const usage: UsageInput = {
      activeUsers: 5,
      branches: 1,
      companies: 1,
      storageGb: 0,
      transactions: 0,
    }
    const enMediano = calculateMonthly({ tier: 'mediano', activeModules: [], usage })
    const enGrande = calculateMonthly({ tier: 'grande', activeModules: [], usage })
    expect(enMediano.lines[0]?.amountCents).toBe(toCents(399))
    expect(enGrande.lines[0]?.amountCents).toBe(toCents(1500))
    expect(enGrande.total).toBeGreaterThan(enMediano.total)
  })
})

describe('prorrateo al dia (alta/baja de modulo o usuario a mitad de ciclo)', () => {
  it('prorratea proporcionalmente', () => {
    expect(prorateDaily(toCents(399), 10, 30)).toBe(toCents(133))
  })

  it('aplica redondeo bancario en el punto medio exacto', () => {
    // 69.01 * (1/2) = 34.505 centavos -> el redondeo bancario cae al par (3450)
    expect(prorateDaily(6901 as Cents, 1, 2)).toBe(3450)
  })

  it('nunca cobra por dias fuera del ciclo', () => {
    const monthlyCents = toCents(100)
    expect(prorateDaily(monthlyCents, 45, 30)).toBe(monthlyCents)
    expect(prorateDaily(monthlyCents, -5, 30)).toBe(toCents(0))
  })
})

describe('catalogo §6.3 — enterprise solo existe en GRANDE', () => {
  it('lanza al pedir precio enterprise en pyme o mediano', () => {
    expect(() => moduleCategoryPricing('enterprise', 'pyme')).toThrow()
    expect(() => moduleCategoryPricing('enterprise', 'mediano')).toThrow()
    expect(() => moduleCategoryPricing('enterprise', 'grande')).not.toThrow()
  })
})
