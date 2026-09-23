import { ITBIS_RATE } from './discounts.js'

/**
 * Del dato del cliente a la entrada del motor.
 *
 * Son decisiones de COBRO, no de consulta: por eso viven aqui y no en la
 * query que junta los numeros. Quien cuenta usuarios o bytes no decide
 * como se redondea ni que impuesto aplica.
 */

/**
 * Impuesto que lleva la factura de REGB segun el pais del cliente
 * (`regb.tenants.country`, ISO 3166 alfa-2, `DO` por defecto).
 *
 * - `DO`: ITBIS 18 %.
 * - Cualquier otro: 0. REGB es una empresa dominicana; venderle a un
 *   cliente de fuera es exportar un servicio, y cuanto impuesto lleva eso
 *   lo decide un contador con el caso delante, no este codigo. Hasta
 *   entonces no se inventa una tasa.
 */
export function taxRateForCountry(country: string | null | undefined): number {
  return (country ?? '').trim().toUpperCase() === 'DO' ? ITBIS_RATE : 0
}

const BYTES_POR_GB = 1024 ** 3

/**
 * GB que se facturan contra el incluido del tier.
 *
 * GiB enteros, redondeando HACIA ABAJO: el cliente siempre gana en el
 * redondeo (agente regb-billing). 10.9 GB en un plan de 10 no pagan nada.
 */
export function billableStorageGb(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  return Math.floor(bytes / BYTES_POR_GB)
}
