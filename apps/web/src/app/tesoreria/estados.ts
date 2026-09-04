/** Etiquetas de los movimientos bancarios. */
export type MovimientoTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export const TIPO_MOVIMIENTO: Record<
  string,
  { label: string; tone: MovimientoTone; icono: string; entra: boolean }
> = {
  deposit: { label: 'Deposito', tone: 'success', icono: 'south_west', entra: true },
  withdrawal: { label: 'Retiro', tone: 'warning', icono: 'north_east', entra: false },
  transfer_in: { label: 'Entrada por transferencia', tone: 'info', icono: 'swap_horiz', entra: true },
  transfer_out: { label: 'Salida por transferencia', tone: 'info', icono: 'swap_horiz', entra: false },
}

export const TIPO_CUENTA: Record<string, string> = {
  checking: 'Corriente',
  savings: 'Ahorros',
}
