/**
 * El XML del e-CF, armado contra el XSD REAL de la DGII.
 *
 * Los nombres de elemento, su ORDEN, los valores permitidos y los
 * formatos de este archivo no salen de una guia ni de un ejemplo: se
 * extrajeron del `e-CF 32 v.1.0.xsd` descargado de dgii.gov.do. Eso
 * importa porque un `xs:sequence` es ORDENADO: los mismos campos en
 * distinto orden no validan, y el rechazo llega asincrono, horas
 * despues, con un codigo.
 *
 * La salida SI se valido contra el XSD oficial con `lxml` (ver
 * `scripts/validar-ecf-xsd.py`), y esa validacion encontro dos cosas que
 * leer el esquema a ojo no habia dado:
 *
 *  1. `TelefonoEmisor` exige el patron `\d{3}-\d{3}-\d{4}` -CON
 *     guiones-. Un telefono en digitos corridos invalida el documento.
 *  2. Despues de `FechaHoraFirma` el esquema pide un `<xs:any
 *     minOccurs="1">`: la **firma digital**. O sea que un e-CF SIN FIRMAR
 *     no valida contra el esquema, por perfecto que este el resto. La
 *     firma no es un paso posterior opcional: es un hijo obligatorio.
 *
 * ⚠️ Lo que sigue sin hacerse: firmar de verdad (hace falta el
 * certificado) y mandarlo a la DGII.
 *
 * Alcance de hoy: la factura de consumo (E32), que es el caso principal
 * de una PYME dominicana. Los otros nueve tipos comparten el esqueleto
 * pero tienen sus propias obligatoriedades.
 */

import { UMBRAL_RFCE } from './ecf.js'

// ── Valores permitidos, verbatim del XSD ─────────────────────────────────

/** `TipoeCFType`. Confirma los diez tipos desde la fuente primaria. */
export const TIPOS_ECF_XSD = ['31', '32', '33', '34', '41', '43', '44', '45', '46', '47'] as const

/** `TipoIngresosValidationType`. */
export const TIPOS_INGRESO = ['01', '02', '03', '04', '05', '06'] as const
export type TipoIngreso = (typeof TIPOS_INGRESO)[number]

/** `TipoPagoType`: 1 contado, 2 credito, 3 gratuito. */
export const TIPOS_PAGO = ['1', '2', '3'] as const
export type TipoPago = (typeof TIPOS_PAGO)[number]

/** `FormaPagoType`: ocho formas. */
export const FORMAS_PAGO_ECF = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
export type FormaPagoEcf = (typeof FORMAS_PAGO_ECF)[number]

/** `IndicadorFacturacionType`: como tributa la linea. */
export const INDICADORES_FACTURACION = ['0', '1', '2', '3', '4'] as const
export type IndicadorFacturacion = (typeof INDICADORES_FACTURACION)[number]

/** `IndicadorBienoServicioType`: 1 bien, 2 servicio. */
export const INDICADORES_BIEN_SERVICIO = ['1', '2'] as const
export type IndicadorBienOServicio = (typeof INDICADORES_BIEN_SERVICIO)[number]

/** La version del esquema que se emite. */
export const VERSION_ECF = '1.0'

// ── Formatos, tambien del XSD ────────────────────────────────────────────

/**
 * `FechaValidationType` pide **DD-MM-AAAA**, no ISO.
 *
 * Es el error mas facil de cometer viniendo de una base de datos, donde
 * todo es AAAA-MM-DD. Se convierte aqui y en un solo sitio.
 */
export function fechaEcf(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${d.getUTCFullYear()}`
}

/** `DateTimeValidationType`: **DD-MM-AAAA HH:mm:ss**, con espacio, no "T". */
export function fechaHoraEcf(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${fechaEcf(d)} ${hh}:${mi}:${ss}`
}

/**
 * El telefono del emisor, en el unico formato que el esquema admite.
 *
 * `\d{3}-\d{3}-\d{4}`, CON guiones. Lo encontro el validador contra el
 * XSD oficial: en digitos corridos -que es como suele venir de una base
 * de datos- el documento ENTERO se rechaza por un campo opcional.
 *
 * Devuelve `null` si no se puede poner en ese formato, para que quien
 * arma el XML lo omita en vez de invalidarlo.
 */
export function telefonoEcf(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  if (d.length !== 10) return null
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}

/**
 * Montos: hasta 2 decimales y **sin separador de miles**.
 *
 * El patron del XSD es `[0-9]{1,16}(\.[0-9]{1,2})?`: un `toLocaleString`
 * mete comas y rompe la validacion entera.
 */
export function montoEcf(n: number): string {
  return n.toFixed(2)
}

/** Precios unitarios admiten 4 decimales (`Decimal20D1or4`). */
export function precioEcf(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}

// ── Escapado ─────────────────────────────────────────────────────────────

/**
 * Escapa lo que XML no admite en un valor.
 *
 * Un nombre de producto con `&` -"Frenos & Clutch"- rompe el documento
 * entero, no solo esa linea. Es de los fallos mas tontos y mas caros.
 */
export function escaparXml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ── El documento ─────────────────────────────────────────────────────────

export interface LineaEcf {
  numeroLinea: number
  nombre: string
  indicadorFacturacion: IndicadorFacturacion
  bienOServicio: IndicadorBienOServicio
  cantidad: number
  precioUnitario: number
  montoItem: number
}

export interface EcfConsumo {
  encf: string
  tipoIngresos: TipoIngreso
  tipoPago: TipoPago
  emisor: {
    rnc: string
    razonSocial: string
    direccion: string
    telefono?: string
    fechaEmision: Date
  }
  comprador?: {
    rnc?: string | null
    razonSocial?: string | null
  }
  totales: {
    montoGravadoTotal?: number
    montoExento?: number
    totalItbis?: number
    montoTotal: number
  }
  lineas: LineaEcf[]
  fechaHoraFirma: Date
  /**
   * El bloque `<ds:Signature>` ya calculado.
   *
   * El esquema lo exige (`<xs:any minOccurs="1">` despues de
   * `FechaHoraFirma`), asi que SIN el el documento no valida. Se recibe
   * hecho y no se calcula aqui a proposito: firmar necesita el
   * certificado del contribuyente, que es material sensible y no tiene
   * nada que hacer en una funcion pura.
   */
  firma?: string
}

function etiqueta(nombre: string, valor: string | number): string {
  return `<${nombre}>${escaparXml(String(valor))}</${nombre}>`
}

function opcional(nombre: string, valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return ''
  return etiqueta(nombre, valor)
}

/**
 * Arma el XML de una Factura de Consumo Electronica (E32).
 *
 * El orden de las etiquetas ES el del XSD y no se puede reordenar por
 * gusto. Por eso este generador es una plantilla lineal y no un objeto
 * que se serializa: la forma del codigo hace visible el orden que la
 * norma exige, y un cambio accidental salta en la lectura.
 *
 * `Comprador` se emite aunque vaya vacio porque el XSD lo pide (1..1)
 * aunque todos sus hijos sean opcionales: en una venta de mostrador no
 * hay a quien identificar, pero la etiqueta tiene que estar.
 */
export function xmlEcfConsumo(d: EcfConsumo): string {
  if (!/^[a-zA-Z0-9]{13}$/.test(d.encf)) {
    throw new Error(`El e-NCF "${d.encf}" no tiene los 13 caracteres que exige el esquema.`)
  }
  if (d.lineas.length === 0) {
    throw new Error('Un e-CF sin lineas no valida: DetallesItems exige al menos un Item.')
  }
  if (!/^\d{9}$|^\d{11}$/.test(d.emisor.rnc)) {
    throw new Error('El RNC del emisor debe tener 9 u 11 digitos, sin guiones.')
  }

  const items = d.lineas
    .map((l) =>
      [
        '<Item>',
        etiqueta('NumeroLinea', l.numeroLinea),
        etiqueta('IndicadorFacturacion', l.indicadorFacturacion),
        etiqueta('NombreItem', l.nombre),
        etiqueta('IndicadorBienoServicio', l.bienOServicio),
        etiqueta('CantidadItem', montoEcf(l.cantidad)),
        etiqueta('PrecioUnitarioItem', precioEcf(l.precioUnitario)),
        etiqueta('MontoItem', montoEcf(l.montoItem)),
        '</Item>',
      ].join(''),
    )
    .join('')

  // El esquema pide `\d{3}-\d{3}-\d{4}`. Si lo que hay no se puede poner
  // en ese formato se OMITE -es opcional- en vez de invalidar el
  // documento entero por un telefono.
  const tel = d.emisor.telefono === undefined ? null : telefonoEcf(d.emisor.telefono)
  const telefono =
    tel === null ? '' : `<TablaTelefonoEmisor>${etiqueta('TelefonoEmisor', tel)}</TablaTelefonoEmisor>`

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ECF>',
    '<Encabezado>',
    etiqueta('Version', VERSION_ECF),
    '<IdDoc>',
    etiqueta('TipoeCF', '32'),
    etiqueta('eNCF', d.encf.toUpperCase()),
    etiqueta('TipoIngresos', d.tipoIngresos),
    etiqueta('TipoPago', d.tipoPago),
    '</IdDoc>',
    '<Emisor>',
    etiqueta('RNCEmisor', d.emisor.rnc),
    etiqueta('RazonSocialEmisor', d.emisor.razonSocial.slice(0, 150)),
    etiqueta('DireccionEmisor', d.emisor.direccion),
    telefono,
    etiqueta('FechaEmision', fechaEcf(d.emisor.fechaEmision)),
    '</Emisor>',
    '<Comprador>',
    opcional('RNCComprador', d.comprador?.rnc ?? null),
    opcional('RazonSocialComprador', d.comprador?.razonSocial ?? null),
    '</Comprador>',
    '<Totales>',
    opcional('MontoGravadoTotal', d.totales.montoGravadoTotal === undefined ? null : montoEcf(d.totales.montoGravadoTotal)),
    opcional('MontoExento', d.totales.montoExento === undefined ? null : montoEcf(d.totales.montoExento)),
    opcional('TotalITBIS', d.totales.totalItbis === undefined ? null : montoEcf(d.totales.totalItbis)),
    etiqueta('MontoTotal', montoEcf(d.totales.montoTotal)),
    '</Totales>',
    '</Encabezado>',
    `<DetallesItems>${items}</DetallesItems>`,
    etiqueta('FechaHoraFirma', fechaHoraEcf(d.fechaHoraFirma)),
    // La firma va aqui, y es OBLIGATORIA para el esquema. Sin ella el
    // documento esta "pre-firma": se puede armar y revisar, pero la DGII
    // lo rechazaria.
    d.firma ?? '',
    '</ECF>',
  ]
    .filter((x) => x !== '')
    .join('')
}

/**
 * Si este consumo va por resumen en vez de completo.
 *
 * Se re-expone aqui, junto al generador, porque es la decision que hay
 * que tomar ANTES de armar el XML: por debajo del umbral el documento
 * que viaja es otro (RFCE) y a otro endpoint. Armar el completo y
 * mandarlo al servicio normal es el error que la norma advierte
 * explicitamente -"no seran recibidas por este servicio"-.
 */
export function vaPorResumen(montoTotal: number): boolean {
  return montoTotal < UMBRAL_RFCE
}

/**
 * Si el documento esta listo para mandarse.
 *
 * Existe para que nadie confunda "el XML esta armado" con "el XML es
 * valido": sin firma el esquema lo rechaza, y el rechazo de la DGII
 * llega asincrono y horas despues.
 */
export function estaFirmado(xml: string): boolean {
  return /<(\w+:)?Signature[\s>]/.test(xml)
}
