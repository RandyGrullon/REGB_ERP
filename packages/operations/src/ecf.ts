/**
 * Facturacion electronica dominicana (e-CF) — reglas de negocio.
 *
 * Logica pura y verificable sin red: lo que se puede probar antes de
 * tener un certificado digital y antes de que la DGII conteste una sola
 * llamada. La transmision, la firma XAdES y los tres servicios que la
 * DGII invoca CONTRA nosotros son otra capa; esta es la que decide que
 * se manda, a donde, y que significa la respuesta.
 *
 * Fuentes: `docs/DGII-ECF-INVESTIGACION.md` (formato, firma, estados,
 * contingencia y representacion impresa, con el enlace oficial de cada
 * afirmacion) y `docs/DGII-ECF-MERCADO.md` (plazos y obligatoriedad).
 *
 * ⚠️ NADA de este archivo se ha probado contra el ambiente de pruebas de
 * la DGII todavia. Son las reglas leidas de la norma, no verificadas
 * contra una respuesta real.
 */

import type { NcfType } from './dgii.js'

/** Los diez tipos de e-CF. No hay otros publicados por la DGII. */
export const TIPOS_ECF = [
  'E31',
  'E32',
  'E33',
  'E34',
  'E41',
  'E43',
  'E44',
  'E45',
  'E46',
  'E47',
] as const

export type TipoEcf = (typeof TIPOS_ECF)[number]

export function esEcf(tipo: NcfType): tipo is TipoEcf {
  return (TIPOS_ECF as readonly string[]).includes(tipo)
}

// ── El corte de RD$250,000 ───────────────────────────────────────────────

/**
 * El umbral que parte la arquitectura en dos.
 *
 * Una Factura de Consumo (E32) por DEBAJO de este monto **no la recibe**
 * el servicio de recepcion normal: va un resumen (RFCE) a otro dominio y
 * otro endpoint. Por encima, va el e-CF completo.
 */
export const UMBRAL_RFCE = 250_000

export type RutaEnvio = 'ecf-completo' | 'rfce-resumen'

/**
 * Por donde se manda este comprobante.
 *
 * Para un ERP de PYMEs esto NO es un caso borde: casi todas las facturas
 * de un colmado o una tienda caen por debajo de RD$250,000, asi que el
 * camino del RESUMEN es el principal y el del e-CF completo es la
 * excepcion. Construir primero el completo seria construir primero lo
 * que casi nunca se usa.
 *
 * El corte aplica SOLO a la factura de consumo (E32). Un credito fiscal
 * (E31) de RD$500 va completo igual, porque el comprador necesita el
 * detalle para descontarse el ITBIS.
 *
 * El emisor conserva el e-CF extendido en los dos casos: mandar el
 * resumen no exime de guardarlo.
 */
export function rutaDeEnvio(tipo: TipoEcf, montoTotal: number): RutaEnvio {
  if (tipo !== 'E32') return 'ecf-completo'
  return montoTotal < UMBRAL_RFCE ? 'rfce-resumen' : 'ecf-completo'
}

// ── Estados del acuse ────────────────────────────────────────────────────

export type EstadoEcf = 0 | 1 | 2 | 3 | 4

export const ESTADO_ECF: Record<EstadoEcf, string> = {
  0: 'No encontrado',
  1: 'Aceptado',
  2: 'Rechazado',
  3: 'En proceso',
  4: 'Aceptado condicional',
}

/**
 * Si el comprobante vale fiscalmente.
 *
 * La trampa: **"Aceptado condicional" (4) SI es valido**. La propia DGII
 * dice que "implica la validez del e-CF" aunque no haya cumplido en
 * algun punto. Tratarlo como error bloquea ventas buenas; tratarlo como
 * un exito limpio esconde algo que la DGII espera que se corrija. Por
 * eso hay tambien `requiereRevision()`.
 */
export function esValidoFiscalmente(estado: EstadoEcf): boolean {
  return estado === 1 || estado === 4
}

/** Vale, pero alguien tiene que mirarlo. */
export function requiereRevision(estado: EstadoEcf): boolean {
  return estado === 4
}

/** Todavia no hay respuesta: hay que volver a consultar el trackId. */
export function sigueEnProceso(estado: EstadoEcf): boolean {
  return estado === 3 || estado === 0
}

/**
 * Si el e-NCF rechazado se puede volver a usar.
 *
 * `secuenciaUtilizada` viene de la DGII y su polaridad es AL REVES de lo
 * que sugiere el nombre: `true` significa que la secuencia ya se quemo y
 * NO se puede reutilizar.
 *
 * Importa porque las secuencias se autorizan por rango: quemar una por
 * cada rechazo de firma mal hecha agota el rango de un cliente sin que
 * haya vendido nada.
 */
export function puedeReutilizarSecuencia(secuenciaUtilizada: boolean): boolean {
  return !secuenciaUtilizada
}

// ── Codigo de seguridad y timbre ─────────────────────────────────────────

/**
 * El codigo de seguridad: los primeros 6 caracteres del `SignatureValue`.
 *
 * No es aleatorio ni lo asigna la DGII: sale de la firma. Por eso no se
 * puede calcular antes de firmar, y por eso el QR de la representacion
 * impresa no existe hasta que el documento esta firmado.
 */
export function codigoSeguridad(signatureValue: string): string {
  const limpio = signatureValue.replace(/\s+/g, '')
  if (limpio.length < 6) {
    throw new Error('El SignatureValue es demasiado corto para sacar el codigo de seguridad.')
  }
  return limpio.slice(0, 6)
}

export type Ambiente = 'testecf' | 'certecf' | 'ecf'

export interface DatosTimbre {
  rncEmisor: string
  rncComprador: string | null
  encf: string
  /** DD-MM-AAAA */
  fechaEmision: string
  montoTotal: number
  /** DD-MM-AAAA HH:mm:ss */
  fechaFirma: string
  codigoSeguridad: string
}

/**
 * La URL que va dentro del QR de la representacion impresa.
 *
 * Se arma con `URLSearchParams`, que escapa exactamente como pide la
 * norma -espacio a `%20`, `#` a `%23`, y el resto de la tabla de
 * caracteres reservados-. Escaparlo a mano es como se cuela un QR que
 * el lector de la DGII no resuelve.
 *
 * El resumen (RFCE) lleva MENOS campos y va a otro dominio: no es la
 * misma URL con parametros de mas.
 */
export function urlTimbre(d: DatosTimbre, ambiente: Ambiente = 'ecf'): string {
  const p = new URLSearchParams({
    rncemisor: d.rncEmisor,
    rnccomprador: d.rncComprador ?? '',
    encf: d.encf,
    fechaemision: d.fechaEmision,
    montototal: d.montoTotal.toFixed(2),
    fechafirma: d.fechaFirma,
    codigoseguridad: d.codigoSeguridad,
  })
  return `https://ecf.dgii.gov.do/${ambiente}/consultatimbre?${p.toString()}`
}

/** El timbre del resumen: otro dominio y solo cuatro campos. */
export function urlTimbreResumen(
  d: Pick<DatosTimbre, 'rncEmisor' | 'encf' | 'montoTotal' | 'codigoSeguridad'>,
  ambiente: Ambiente = 'ecf',
): string {
  const p = new URLSearchParams({
    rncemisor: d.rncEmisor,
    encf: d.encf,
    montototal: d.montoTotal.toFixed(2),
    codigoseguridad: d.codigoSeguridad,
  })
  return `https://fc.dgii.gov.do/${ambiente}/consultatimbrefc?${p.toString()}`
}

/**
 * Nombre del archivo XML: RNC del emisor pegado al e-NCF.
 *
 * A diferencia del 607 -donde el nombre salio de capturas de pantalla y
 * quedo sin confirmar-, aqui esta en la norma tecnica.
 */
export function nombreArchivoEcf(rncEmisor: string, encf: string): string {
  return `${rncEmisor.replace(/\D/g, '')}${encf.toUpperCase()}.xml`
}

// ── Contingencia ─────────────────────────────────────────────────────────

/**
 * Las dos contingencias del Art. 40 del Decreto 587-24 NO son la misma
 * cosa y no se resuelven igual.
 */
export type Contingencia = 'sin-conexion' | 'sin-sistema'

/** Horas para remitir lo emitido sin conexion. */
export const HORAS_PARA_REMITIR = 72

/** Dias calendario maximos emitiendo comprobantes de papel. */
export const DIAS_MAX_SIN_SISTEMA = 15

/**
 * La leyenda que la norma obliga a imprimir en una factura emitida sin
 * conexion. Es texto legal: se copia, no se redacta.
 */
export const LEYENDA_CONTINGENCIA =
  'e-CF emitido en modalidad de Contingencia, el cual podra ser consultado ' +
  'para su validez fiscal, a partir de las setenta y dos (72) horas.'

/** Cuanto queda del plazo de 72 horas. Negativo = ya se vencio. */
export function horasRestantesParaRemitir(emitidoEn: Date, ahora: Date): number {
  const transcurridas = (ahora.getTime() - emitidoEn.getTime()) / 3_600_000
  return Math.round((HORAS_PARA_REMITIR - transcurridas) * 100) / 100
}

export function venciPlazoDeRemision(emitidoEn: Date, ahora: Date): boolean {
  return horasRestantesParaRemitir(emitidoEn, ahora) < 0
}

/**
 * Que comprobante toca emitir mientras dura la contingencia.
 *
 * Sin conexion se sigue emitiendo e-CF -se generan offline y se remiten
 * despues-. Sin sistema NO se puede: toca papel de la serie B, que este
 * ERP ya sabe emitir. Por eso la contingencia del caso "sin sistema" no
 * es codigo nuevo, es un interruptor sobre lo que ya existe.
 */
export function comprobanteEnContingencia(c: Contingencia): 'e-CF' | 'serie-B' {
  return c === 'sin-conexion' ? 'e-CF' : 'serie-B'
}

/** Si la contingencia sin sistema ya paso del maximo legal de 15 dias. */
export function excedioContingencia(inicio: Date, ahora: Date): boolean {
  const dias = (ahora.getTime() - inicio.getTime()) / 86_400_000
  return dias > DIAS_MAX_SIN_SISTEMA
}
