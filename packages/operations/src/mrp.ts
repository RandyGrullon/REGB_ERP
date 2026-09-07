/**
 * Planificacion MRP — §5.4, modulo 57.
 *
 * Explosion de necesidades real: recorre el arbol de un BOM
 * (multinivel, igual que `bom.ts`) y ACUMULA la necesidad bruta de
 * cada componente por su producto -la misma materia prima puede
 * aparecer en varias ramas del mismo arbol, y se suma, no se cuenta
 * dos veces por separado-. `necesidadNeta()` es la resta clasica de
 * MRP: bruta menos lo que ya hay disponible, nunca negativa.
 */

export interface NodoExplosionMrp {
  productId: string
  cantidadNecesaria: number
  /** false = tiene su propia receta activa (sugerencia: producir); true = no tiene, se compra. */
  esComprado: boolean
  subComponentes?: NodoExplosionMrp[]
}

export interface NecesidadComponente {
  productId: string
  cantidadBruta: number
  accion: 'purchase' | 'produce'
}

/**
 * Explota una lista de nodos de nivel superior -tipicamente las lineas
 * de un BOM ya resueltas con su cantidad para la corrida completa- y
 * acumula la necesidad bruta de cada producto que aparece en el arbol,
 * sumando entre ramas repetidas. Un nodo comprado es una hoja -no se
 * expande mas alla de el, aunque tuviera `subComponentes` por error-.
 */
export function explotarNecesidadesMrp(nodos: NodoExplosionMrp[]): NecesidadComponente[] {
  const acumulado = new Map<string, NecesidadComponente>()

  function acumular(productId: string, cantidad: number, accion: 'purchase' | 'produce') {
    const existente = acumulado.get(productId)
    if (existente) {
      existente.cantidadBruta += cantidad
    } else {
      acumulado.set(productId, { productId, cantidadBruta: cantidad, accion })
    }
  }

  function recorrer(nodo: NodoExplosionMrp) {
    acumular(nodo.productId, nodo.cantidadNecesaria, nodo.esComprado ? 'purchase' : 'produce')
    if (!nodo.esComprado && nodo.subComponentes) {
      for (const hijo of nodo.subComponentes) recorrer(hijo)
    }
  }

  for (const n of nodos) recorrer(n)
  return [...acumulado.values()]
}

/** Necesidad neta clasica de MRP: bruta menos lo disponible, nunca negativa. */
export function necesidadNeta(cantidadBruta: number, stockDisponible: number): number {
  return Math.max(0, cantidadBruta - stockDisponible)
}
