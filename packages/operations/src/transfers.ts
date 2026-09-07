/**
 * Transferencias — §5.4, modulo 50.
 *
 * La version minima de `inventory` (0019, `stock_transfers`) mueve
 * stock en un solo paso, sin estado de transito -sirve para un colmado
 * que solo tiene un almacen y mueve cuatro cajas a la sucursal de al
 * lado-. Este modulo NO la reemplaza ni la toca: agrega el flujo
 * completo para quien de verdad necesita saber que esta "en camino"
 * -despachado mueve el stock de origen, recibido mueve el de destino,
 * y lo que llega puede ser distinto de lo que salio-.
 *
 * La discrepancia al recibir reutiliza `detectarDiscrepancia()` de
 * `receipts.ts` -misma pregunta que "llego lo mismo que se esperaba?"-.
 */

export type EstadoTransferencia = 'draft' | 'in_transit' | 'received' | 'cancelled'

const TRANSICIONES_TRANSFERENCIA: Record<EstadoTransferencia, EstadoTransferencia[]> = {
  draft: ['in_transit', 'cancelled'],
  in_transit: ['received'],
  received: [],
  cancelled: [],
}

/**
 * `draft` despacha o cancela; una vez `in_transit` solo se puede
 * recibir -no se cancela algo que ya salio fisicamente del almacen-;
 * `received`/`cancelled` son terminales.
 */
export function transicionValidaTransferencia(
  actual: EstadoTransferencia,
  siguiente: EstadoTransferencia,
): boolean {
  return TRANSICIONES_TRANSFERENCIA[actual].includes(siguiente)
}
