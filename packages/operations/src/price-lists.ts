/**
 * Listas de precios -Sec5.4, modulo 41 (F8/S43).
 *
 * Que lista aplica y que precio corresponde se resuelven siempre en
 * TypeScript, nunca en SQL -mismo principio que within_geofence en
 * attendance o business_days en time-off-.
 */

export type AlcanceLista = 'customer' | 'channel' | 'general'

export interface ListaPrecio {
  id: string
  scope: AlcanceLista
  customerId: string | null
  channel: string | null
  startDate: Date
  endDate: Date | null
  status: string
}

/** Si una lista esta vigente -activa y dentro de su rango de fechas- en una fecha dada. */
export function listaVigente(lista: ListaPrecio, asOf: Date): boolean {
  if (lista.status !== 'active') return false
  if (asOf < lista.startDate) return false
  if (lista.endDate !== null && asOf > lista.endDate) return false
  return true
}

/**
 * Cual lista aplica para un cliente/canal en una fecha -la mas
 * especifica gana-: una lista propia del cliente vence a una de canal,
 * que vence a la general. Entre varias vigentes del mismo alcance, la
 * de inicio mas reciente gana.
 */
export function listaAplicable(
  listas: ListaPrecio[],
  contexto: { customerId: string | null; channel: string | null },
  asOf: Date,
): ListaPrecio | null {
  const vigentes = listas.filter((l) => listaVigente(l, asOf))
  const masReciente = (candidatas: ListaPrecio[]) =>
    candidatas.length === 0
      ? null
      : candidatas.reduce((a, b) => (b.startDate > a.startDate ? b : a))

  if (contexto.customerId !== null) {
    const porCliente = masReciente(
      vigentes.filter((l) => l.scope === 'customer' && l.customerId === contexto.customerId),
    )
    if (porCliente) return porCliente
  }

  if (contexto.channel !== null) {
    const porCanal = masReciente(vigentes.filter((l) => l.scope === 'channel' && l.channel === contexto.channel))
    if (porCanal) return porCanal
  }

  return masReciente(vigentes.filter((l) => l.scope === 'general'))
}

/**
 * Precio por volumen: el de la cuota mas alta que la cantidad todavia
 * alcanza -1 unidad usa el precio base, 100 unidades usa el precio de
 * mayoreo si existe una cuota para 100 o menos-.
 */
export function precioPorVolumen(
  entradas: { minQuantity: number; unitPrice: number }[],
  cantidad: number,
): number | null {
  const aplicables = entradas.filter((e) => cantidad >= e.minQuantity)
  if (aplicables.length === 0) return null
  return aplicables.reduce((a, b) => (b.minQuantity > a.minQuantity ? b : a)).unitPrice
}

export interface EntradaLista {
  priceListId: string
  minQuantity: number
  unitPrice: number
}

export interface PrecioResuelto {
  precio: number
  /** De que lista salio. `null` = del catalogo, sin lista de por medio. */
  listaId: string | null
}

/**
 * El precio que de verdad se cobra.
 *
 * Junta las dos piezas que ya existian por separado -cual lista aplica y
 * que cuota de volumen le toca- y, sobre todo, define el RESPALDO: si no
 * hay lista aplicable, o la hay pero no cubre ese producto en esa
 * cantidad, se cobra el precio del catalogo.
 *
 * Ese respaldo es lo que hace que esto se pueda encender sin romper
 * nada: un negocio sin listas cobra exactamente como antes. Y es por lo
 * que la resolucion NO puede vivir en SQL -una lista que no cubre un
 * producto tiene que caer al catalogo, no devolver cero filas y dejar la
 * linea sin precio-.
 *
 * Cuando el modulo `price-lists` esta apagado, RLS hace que `listas`
 * llegue vacia y esto devuelve el catalogo solo. No hace falta -ni se
 * debe- preguntar por el id del modulo en ninguna parte.
 */
export function resolverPrecio(
  precioBase: number,
  listas: ListaPrecio[],
  entradas: EntradaLista[],
  contexto: { customerId: string | null; channel: string | null; cantidad: number },
  asOf: Date,
): PrecioResuelto {
  const lista = listaAplicable(listas, contexto, asOf)
  if (lista === null) return { precio: precioBase, listaId: null }

  const deLista = precioPorVolumen(
    entradas.filter((e) => e.priceListId === lista.id),
    contexto.cantidad,
  )
  if (deLista === null) return { precio: precioBase, listaId: null }

  return { precio: deLista, listaId: lista.id }
}
