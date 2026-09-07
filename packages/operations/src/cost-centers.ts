import { roundBankers } from '@regb/core'

/**
 * Centros de costo — §5, modulo 23 (F6/S35).
 *
 * El prorrateo es la pieza que de verdad necesita logica propia: repartir
 * un monto entre varios centros segun un peso (porcentaje o ratio) y que
 * la suma cuadre EXACTO contra el total -el bug clasico de un prorrateo es
 * que 33.33 + 33.33 + 33.33 = 99.99, no 100-. `splitAmount()` resuelve
 * esto dejando que el ULTIMO centro absorba el residuo de redondeo, en vez
 * de repartir el error entre todos.
 */

export interface CostCenterWeight {
  costCenterId: string
  weight: number
}

export interface CostCenterSplit {
  costCenterId: string
  amount: number
}

/**
 * Reparte `total` entre los centros segun su peso relativo. Los pesos no
 * necesitan sumar 100 -se normalizan solos-. El ultimo centro de la lista
 * se ajusta para que la suma de todos los montos sea EXACTAMENTE `total`,
 * nunca un centavo de mas o de menos por redondeo.
 */
export function splitAmount(total: number, weights: CostCenterWeight[]): CostCenterSplit[] {
  if (weights.length === 0) return []
  const pesoTotal = weights.reduce((a, w) => a + w.weight, 0)
  if (pesoTotal <= 0) return []

  let acumulado = 0
  return weights.map((w, i) => {
    if (i === weights.length - 1) {
      return { costCenterId: w.costCenterId, amount: roundBankers(total - acumulado, 2) }
    }
    const monto = roundBankers((total * w.weight) / pesoTotal, 2)
    acumulado = roundBankers(acumulado + monto, 2)
    return { costCenterId: w.costCenterId, amount: monto }
  })
}

export interface CostCenterAllocationInput {
  costCenterId: string
  amount: number
}

export interface CostCenterTotal {
  costCenterId: string
  total: number
}

/** Suma las asignaciones por centro, sin importar el orden en que lleguen. */
export function buildCostCenterTotals(allocations: CostCenterAllocationInput[]): CostCenterTotal[] {
  const porCentro = new Map<string, number>()
  for (const a of allocations) {
    porCentro.set(a.costCenterId, roundBankers((porCentro.get(a.costCenterId) ?? 0) + a.amount, 2))
  }
  return [...porCentro.entries()].map(([costCenterId, total]) => ({ costCenterId, total }))
}
