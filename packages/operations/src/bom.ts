/**
 * Lista de materiales (BOM) — §5.4, modulo 55.
 *
 * Multinivel de verdad: un componente puede tener su propia receta
 * (sub-BOM), y `costoUnitarioMultinivel()` la resuelve recursivamente
 * -no asume que todo BOM tiene un solo nivel de componentes-. La
 * recursion en si vive aqui, PURA: quien la llama ya trae el arbol
 * armado (con las consultas a la base resueltas de antemano), porque
 * una funcion pura no puede ir a buscar el sub-BOM de un componente
 * por su cuenta.
 */

export interface NodoBom {
  productId: string
  /** Cuantas unidades de este componente hacen falta por CADA unidad del padre. */
  cantidadPorUnidad: number
  /** Costo directo del producto (`products.cost`), usado si no tiene sub-receta. */
  costoDirecto: number
  /** Si este componente tiene su propia receta, sus componentes ya resueltos. */
  subComponentes?: NodoBom[]
}

/**
 * Costo de UNA unidad de este nodo. Si no tiene sub-receta, es su
 * costo directo. Si la tiene, es la suma de sus sub-componentes -cada
 * uno multiplicado por cuanto hace falta de el, y recursivamente
 * resuelto si el sub-componente TAMBIEN tiene su propia receta-.
 */
export function costoUnitarioMultinivel(nodo: NodoBom): number {
  if (!nodo.subComponentes || nodo.subComponentes.length === 0) {
    return nodo.costoDirecto
  }
  return nodo.subComponentes.reduce(
    (acc, hijo) => acc + costoUnitarioMultinivel(hijo) * hijo.cantidadPorUnidad,
    0,
  )
}

/**
 * Cuanto de un componente hace falta para producir `cantidadDeseada`
 * unidades del padre -la explosion de materiales de un solo nivel-.
 */
export function explotarCantidad(cantidadPorUnidad: number, cantidadDeseada: number): number {
  return cantidadPorUnidad * cantidadDeseada
}

/**
 * Elige que componente usar cuando hay un sustituto declarado: el
 * principal si alcanza el stock, si no el sustituto si ese alcanza, si
 * no ninguno -hay faltante real, no se inventa disponibilidad-.
 */
export function elegirComponente(
  cantidadNecesaria: number,
  stockPrincipal: number,
  stockSustituto: number,
): 'principal' | 'sustituto' | 'faltante' {
  if (stockPrincipal >= cantidadNecesaria) return 'principal'
  if (stockSustituto >= cantidadNecesaria) return 'sustituto'
  return 'faltante'
}
