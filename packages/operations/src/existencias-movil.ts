/**
 * Consulta de existencias desde el telefono, en el piso de venta.
 *
 * ── Por que esta pantalla y no otra ───────────────────────────────────
 *
 * Es el momento en que el cliente entiende para que compro el ERP: un
 * vendedor con una caja en la mano, delante de alguien que pregunta
 * "¿tienes de este?", y la respuesta en cinco segundos sin ir al almacen
 * ni llamar a nadie.
 *
 * Todo lo que hay aqui es LOGICA PURA. La pantalla de React Native se
 * limita a pintar lo que estas funciones devuelven, y por eso se pueden
 * probar sin simulador, sin telefono y sin base de datos.
 */

export interface ExistenciaMovil {
  productId: string
  sku: string
  nombre: string
  /** Codigo de barras, si el producto lo tiene. */
  barcode: string | null
  /** Nombre del almacen, para enseñarlo. */
  almacen: string
  /**
   * Id del almacen. Opcional porque la pantalla de consulta no lo
   * necesita; la de transferencias si, para filtrar por origen.
   *
   * Existe para no tener que meter el id dentro de `almacen`: compilaria
   * igual y la siguiente persona leeria un nombre donde hay un uuid.
   */
  almacenId?: string
  cantidad: number
  reservado: number
  precio: number | null
}

/**
 * Lo que se le enseña al vendedor de una fila agrupada por producto.
 *
 * `disponible` es cantidad MENOS reservado, y no es un tecnicismo: un
 * producto con 5 en almacen y 5 apartados para un pedido confirmado no
 * se puede vender, y prometerselo a un cliente en el mostrador es como
 * se incumple una entrega.
 */
export interface ResumenProducto {
  productId: string
  sku: string
  nombre: string
  precio: number | null
  total: number
  disponible: number
  porAlmacen: { almacen: string; cantidad: number; disponible: number }[]
}

export function agruparPorProducto(filas: ExistenciaMovil[]): ResumenProducto[] {
  const mapa = new Map<string, ResumenProducto>()

  for (const f of filas) {
    let r = mapa.get(f.productId)
    if (r === undefined) {
      r = {
        productId: f.productId,
        sku: f.sku,
        nombre: f.nombre,
        precio: f.precio,
        total: 0,
        disponible: 0,
        porAlmacen: [],
      }
      mapa.set(f.productId, r)
    }
    const disponible = f.cantidad - f.reservado
    r.total += f.cantidad
    r.disponible += disponible
    r.porAlmacen.push({ almacen: f.almacen, cantidad: f.cantidad, disponible })
  }

  for (const r of mapa.values()) {
    // El almacen con mas disponible primero: es al que hay que ir.
    r.porAlmacen.sort((a, b) => b.disponible - a.disponible || a.almacen.localeCompare(b.almacen))
  }

  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Filtro de una sola caja de texto.
 *
 * Un vendedor con el telefono en una mano y una caja en la otra no va a
 * elegir entre "buscar por SKU" y "buscar por nombre". Escribe lo que
 * tiene delante y el sistema decide.
 *
 * El codigo de barras se compara COMPLETO y no por fragmento: un lector
 * bluetooth -que se comporta como un teclado- teclea el codigo entero de
 * golpe, y buscar por fragmento devolveria media tienda mientras lo
 * teclea.
 */
export function filtrarExistencias(filas: ExistenciaMovil[], texto: string): ExistenciaMovil[] {
  const q = texto.trim().toLowerCase()
  if (q === '') return filas

  return filas.filter(
    (f) =>
      f.barcode?.toLowerCase() === q ||
      f.sku.toLowerCase().includes(q) ||
      f.nombre.toLowerCase().includes(q),
  )
}

/** Si el texto escrito es exactamente un codigo de barras de la lista. */
export function esCodigoExacto(filas: ExistenciaMovil[], texto: string): boolean {
  const q = texto.trim().toLowerCase()
  return q !== '' && filas.some((f) => f.barcode?.toLowerCase() === q)
}

export type Semaforo = 'hay' | 'poco' | 'nada'

/**
 * El color de la fila.
 *
 * Se calcula sobre DISPONIBLE, no sobre la cantidad fisica: lo que el
 * vendedor puede prometer es lo que no esta apartado.
 *
 * "poco" a partir de 3 y no de un umbral por producto: el punto de
 * reorden vive en el catalogo y sirve para comprar, que es otra
 * decision. Aqui la pregunta es "¿se lo prometo a este señor?", y ahi
 * quedar con dos unidades ya es motivo para mirar antes de prometer.
 */
export const POCAS_UNIDADES = 3

export function semaforo(disponible: number): Semaforo {
  if (disponible <= 0) return 'nada'
  return disponible < POCAS_UNIDADES ? 'poco' : 'hay'
}

export function textoSemaforo(disponible: number): string {
  const s = semaforo(disponible)
  if (s === 'nada') return 'Agotado'
  if (s === 'poco') return `Quedan ${disponible}`
  return `${disponible} disponibles`
}
