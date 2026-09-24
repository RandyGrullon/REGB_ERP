import type { ModulePageCtx } from '@/lib/module-page'
import { exigir } from '@/lib/module-page'

/**
 * Quien puede ver (y por tanto escribir) el costo de lo que se recibe.
 *
 * El costo de compra es lo mismo que protege `inventory.cost.view` (0109):
 * con el costo y el precio de venta se saca el margen. El almacenista de
 * fabrica lo tiene negado a proposito, pero es quien recibe el camion, y
 * la pantalla de recepcion le precargaba el costo cotizado de cada linea.
 *
 * El comprador si lo ve: la orden de compra que el mismo arma lleva el
 * costo. Por eso vale cualquiera de los dos permisos.
 */
export function puedeVerCostoDeCompra(ctx: ModulePageCtx): boolean {
  return (
    exigir(ctx, 'inventory', 'inventory.cost.view').ok ||
    exigir(ctx, 'purchase-orders', 'purchase-orders.view').ok
  )
}
