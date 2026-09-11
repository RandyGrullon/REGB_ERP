import 'server-only'

import { resolverPrecio, type EntradaLista, type ListaPrecio } from '@regb/operations'
import type { TransactionSql } from 'postgres'

/**
 * El precio de venta, resuelto contra las listas de precio.
 *
 * Vive aqui y no en cada pantalla porque el mostrador y los pedidos
 * TIENEN que cobrar igual: un cliente mayorista que compra en caja y otro
 * que compra por pedido no pueden pagar distinto por lo mismo. Cuando el
 * calculo estaba solo dentro de la pantalla de listas de precio, las dos
 * ventas cobraban el precio del catalogo y la lista no servia de nada.
 *
 * Si el modulo `price-lists` esta apagado, RLS deja las dos consultas en
 * cero filas y `resolverPrecio()` devuelve el precio del catalogo. Por
 * eso aqui NO se pregunta por el id de ningun modulo: la respuesta
 * correcta sale sola.
 */

export interface PrecioPedido {
  productId: string
  cantidad: number
  precioBase: number
}

export interface PrecioResultado {
  precio: number
  listaId: string | null
}

interface FilaLista {
  id: string
  scope: string
  customer_id: string | null
  channel: string | null
  start_date: string
  end_date: string | null
  status: string
}

interface FilaEntrada {
  price_list_id: string
  product_id: string
  min_quantity: string
  unit_price: string
}

/**
 * Resuelve el precio de VARIAS lineas de una vez.
 *
 * En lote a proposito: un ticket de caja con quince articulos no puede
 * hacer treinta consultas. Las listas del tenant se traen una sola vez y
 * las entradas se filtran por los productos del carrito.
 */
export async function preciosDeVenta(
  tx: TransactionSql,
  tenantId: string,
  lineas: PrecioPedido[],
  contexto: { customerId: string | null; channel: string | null },
  asOf: Date = new Date(),
): Promise<Map<string, PrecioResultado>> {
  const salida = new Map<string, PrecioResultado>()
  if (lineas.length === 0) return salida

  const productIds = [...new Set(lineas.map((l) => l.productId))]

  const filasListas = await tx<FilaLista[]>`
    select id, scope, customer_id, channel, start_date::text, end_date::text, status
    from public.price_lists
    where tenant_id = ${tenantId}`

  // Sin listas no hay nada que resolver: se ahorra la segunda consulta y
  // cada linea se queda con el precio del catalogo. Es el caso normal de
  // un negocio que todavia no usa listas, y tiene que costar cero.
  if (filasListas.length === 0) {
    for (const l of lineas) salida.set(l.productId, { precio: l.precioBase, listaId: null })
    return salida
  }

  const filasEntradas = await tx<FilaEntrada[]>`
    select price_list_id, product_id, min_quantity::text, unit_price::text
    from public.price_list_entries
    where tenant_id = ${tenantId} and product_id = any(${productIds})`

  const listas: ListaPrecio[] = filasListas.map((l) => ({
    id: l.id,
    scope: l.scope as ListaPrecio['scope'],
    customerId: l.customer_id,
    channel: l.channel,
    startDate: new Date(`${l.start_date}T00:00:00Z`),
    endDate: l.end_date === null ? null : new Date(`${l.end_date}T23:59:59Z`),
    status: l.status,
  }))

  for (const l of lineas) {
    const entradas: EntradaLista[] = filasEntradas
      .filter((e) => e.product_id === l.productId)
      .map((e) => ({
        priceListId: e.price_list_id,
        minQuantity: Number(e.min_quantity),
        unitPrice: Number(e.unit_price),
      }))

    salida.set(
      l.productId,
      resolverPrecio(l.precioBase, listas, entradas, { ...contexto, cantidad: l.cantidad }, asOf),
    )
  }

  return salida
}

/** Atajo para una sola linea -un pedido se arma de a un renglon-. */
export async function precioDeVenta(
  tx: TransactionSql,
  tenantId: string,
  linea: PrecioPedido,
  contexto: { customerId: string | null; channel: string | null },
  asOf: Date = new Date(),
): Promise<PrecioResultado> {
  const m = await preciosDeVenta(tx, tenantId, [linea], contexto, asOf)
  return m.get(linea.productId) ?? { precio: linea.precioBase, listaId: null }
}
