import { roundBankers, type Cents } from '@regb/core'

/**
 * Prorrateo al dia (regla 6 del agente regb-billing): altas y bajas de
 * modulos o usuarios a mitad de ciclo se cobran solo por los dias activos.
 */
export function prorateDaily(monthlyCents: Cents, daysActive: number, daysInCycle: number): Cents {
  if (daysInCycle <= 0) throw new Error('daysInCycle debe ser mayor que cero')
  const clampedDays = Math.min(Math.max(daysActive, 0), daysInCycle)
  return roundBankers(monthlyCents * (clampedDays / daysInCycle), 0) as Cents
}
