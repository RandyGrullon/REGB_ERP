export { tipoEventoValido } from './automations.js'

/** Si ya se alcanzo el limite de solicitudes de la ventana actual. */
export function limiteExcedido(usadosEnVentana: number, limitePorMinuto: number): boolean {
  return usadosEnVentana >= limitePorMinuto
}
