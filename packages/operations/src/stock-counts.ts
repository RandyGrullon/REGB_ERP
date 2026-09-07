/**
 * Conteos ciclicos — §5.4, modulo 51.
 *
 * `inventory` (0019) ya tiene `stock_counts`/`stock_count_lines`: abrir
 * un conteo, escribir lo contado junto al numero del sistema, cerrar y
 * ajustar de una vez. Este modulo NO la reemplaza: agrega lo que el
 * catalogo promete y esa version no tiene -programacion ABC real
 * (clasificarAbc(), Pareto 80/15/5, no una tabla que alguien llena a
 * mano), conteo CIEGO (quien cuenta no ve el numero del sistema
 * mientras cuenta -esa es la diferencia real con la version simple-),
 * y ajustes que necesitan aprobacion antes de tocar el inventario-.
 *
 * `countVariance()`/`varianceValue()` de `costing.ts` se reutilizan
 * tal cual para la diferencia y su impacto en pesos.
 */

export type ClaseAbc = 'A' | 'B' | 'C'

export interface ProductoValor {
  productId: string
  valorAnual: number
}

export interface ClasificacionAbc {
  productId: string
  clase: ClaseAbc
}

/**
 * Clasificacion ABC clasica (Pareto): ordena de mayor a menor valor
 * anual y corta en 80% (A) / 95% (B) / resto (C) del valor acumulado
 * ANTES de cada producto -no despues-: asi el producto que empuja el
 * acumulado a cruzar el 80% todavia cae en A, no lo saltan a B solo
 * por haber sido el que completo la cuenta. Es lo que permite que un
 * solo producto que concentra el 90% del valor total siga siendo A el
 * solo, en vez de cortarlo a mitad de camino. No es una proporcion
 * fija del NUMERO de productos -es del VALOR acumulado-.
 */
export function clasificarAbc(productos: ProductoValor[]): ClasificacionAbc[] {
  const ordenados = [...productos].sort((a, b) => b.valorAnual - a.valorAnual)
  const total = ordenados.reduce((acc, p) => acc + Math.max(0, p.valorAnual), 0)

  if (total <= 0) {
    return ordenados.map((p) => ({ productId: p.productId, clase: 'C' as const }))
  }

  let acumuladoAntes = 0
  return ordenados.map((p) => {
    const pctAntes = acumuladoAntes / total
    const clase: ClaseAbc = pctAntes < 0.8 ? 'A' : pctAntes < 0.95 ? 'B' : 'C'
    acumuladoAntes += Math.max(0, p.valorAnual)
    return { productId: p.productId, clase }
  })
}

/** Cuantos dias entre conteos segun la clase -A se cuenta seguido, C casi nunca-. */
export function frecuenciaConteoDias(clase: ClaseAbc): number {
  return { A: 30, B: 90, C: 180 }[clase]
}

/** Si un producto ya deberia volver a contarse -nunca contado cuenta como vencido de una vez-. */
export function proximoConteoVencido(
  lastCountedAt: Date | null,
  frequencyDays: number,
  asOf: Date,
): boolean {
  if (lastCountedAt === null) return true
  const diasDesde = (asOf.getTime() - lastCountedAt.getTime()) / 86_400_000
  return diasDesde >= frequencyDays
}

export type EstadoConteoCiclico = 'counting' | 'pending_approval' | 'approved' | 'rejected'

const TRANSICIONES_CONTEO: Record<EstadoConteoCiclico, EstadoConteoCiclico[]> = {
  counting: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: [],
  rejected: [],
}

/**
 * `counting` solo puede pasar a pedir aprobacion; desde ahi se aprueba
 * o se rechaza -nunca se salta directo de contando a aprobado, el
 * ajuste siempre pasa por alguien mas-.
 */
export function transicionValidaConteo(
  actual: EstadoConteoCiclico,
  siguiente: EstadoConteoCiclico,
): boolean {
  return TRANSICIONES_CONTEO[actual].includes(siguiente)
}
