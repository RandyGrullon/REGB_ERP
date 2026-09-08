export { diasAbierto as diasPedidoCanalPendiente } from './quality.js'

export type EstadoPedidoCanal = 'received' | 'imported' | 'cancelled'

const TRANSICIONES_PEDIDO_CANAL: Record<EstadoPedidoCanal, EstadoPedidoCanal[]> = {
  received: ['imported', 'cancelled'],
  imported: [],
  cancelled: [],
}

export function transicionValidaPedidoCanal(actual: EstadoPedidoCanal, siguiente: EstadoPedidoCanal): boolean {
  return TRANSICIONES_PEDIDO_CANAL[actual].includes(siguiente)
}
