/**
 * Archivos de envio 607 y 608 de la DGII.
 *
 * Formato tomado de la **Norma General 07-2018 sobre Comprobantes
 * Fiscales**, Anexos B (607) y C (608), y de los instructivos oficiales
 * de la herramienta de envio (607 de dic. 2025, 608 de mar. 2026).
 *
 * ── Lo que la norma dice literalmente ────────────────────────────────
 *
 *   "Para el archivo en formato .txt los campos deberan ser delimitados
 *    por pipe (|)"
 *
 * Hay linea de cabecera obligatoria de 4 campos, y el conteo de registros
 * NO incluye esa linea.
 *
 * ── Lo que la norma NO dice, y aqui se decide ────────────────────────
 *
 * Estas cuatro cosas no estan documentadas en ninguna fuente, oficial ni
 * secundaria. Se eligio lo que hace la propia herramienta de la DGII, que
 * es una macro de Excel sobre Windows:
 *
 *   1. **Sin pipe final.** La linea termina en el ultimo valor.
 *   2. **Fin de linea CRLF.**
 *   3. **Codificacion UTF-8 sin BOM.** El archivo no lleva acentos en
 *      ningun campo que generemos, asi que la eleccion es inocua salvo
 *      que un nombre se colara — y no se cuela: no hay campos de texto
 *      libre en el 607.
 *   4. **Campos vacios entre dos pipes** (`||`), manteniendo siempre el
 *      numero de campos: el formato es posicional.
 *
 * Ninguna de las cuatro esta confirmada. Si el primer envio real rebota,
 * es aqui donde se toca — y por eso estan aisladas en constantes.
 *
 * ⚠️ NO VERIFICADO CONTRA UN ARCHIVO REAL ACEPTADO. Antes del primer
 * envio de un cliente, comparar la salida con un TXT suyo que la DGII ya
 * haya aceptado. Ver docs/DGII-FORMATO-ENVIO.md.
 */

const SEP = '|'
const EOL = '\r\n'

/** Campos del detalle del 607, en el orden del Anexo B. */
export const CAMPOS_607 = 23
/** Campos del detalle del 608, en el orden del Anexo C. */
export const CAMPOS_608 = 3

export type TipoIdentificacion = '1' | '2' | '3'

/**
 * Motivos de anulacion del 608 (campo 3), tal como los enumera el
 * instructivo oficial. La DGII pide el CODIGO, no una descripcion, asi
 * que un motivo escrito a mano no sirve para declarar.
 */
export const TIPOS_ANULACION: Record<string, string> = {
  '1': 'Deterioro de factura preimpresa',
  '2': 'Errores de impresion (factura preimpresa)',
  '3': 'Impresion defectuosa',
  '4': 'Correccion de la informacion',
  '5': 'Cambio de productos',
  '6': 'Devolucion de productos',
  '7': 'Omision de productos',
  '8': 'Errores en secuencia de NCF',
}

/** ¿Es uno de los ocho codigos que acepta la DGII? */
export function esMotivoDgii(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(TIPOS_ANULACION, v)
}

export interface LineaVenta607 {
  /** RNC o cedula del COMPRADOR, solo digitos. Vacio si no se identifico. */
  rncComprador: string | null
  tipoIdentificacion: TipoIdentificacion
  ncf: string
  /** AAAAMMDD */
  fechaComprobante: string
  /** Sin ITBIS ni otros impuestos. */
  montoFacturado: number
  itbisFacturado: number
  /** Formas de pago. Estos SI incluyen impuestos y deben sumar el total. */
  efectivo?: number
  chequeTransferencia?: number
  tarjeta?: number
  credito?: number
}

export interface LineaAnulado608 {
  ncf: string
  /** AAAAMMDD */
  fechaComprobante: string
  /** Codigo 1-8 de TIPOS_ANULACION. */
  tipoAnulacion: string
}

/** Monto con punto decimal y dos cifras. El cero se omite: la DGII no lo pide. */
function monto(n: number | undefined): string {
  if (n === undefined || n === null || n === 0) return ''
  return n.toFixed(2)
}

function linea(campos: (string | undefined)[], esperados: number): string {
  if (campos.length !== esperados) {
    throw new Error(`La linea debe tener ${esperados} campos y tiene ${campos.length}.`)
  }
  // Un pipe dentro de un valor romperia el conteo posicional de toda la
  // fila. No hay escape definido en la norma, asi que se rechaza antes de
  // generar un archivo que el validador de la DGII no sabria leer.
  for (const c of campos) {
    if (c?.includes(SEP)) throw new Error(`Un campo contiene "${SEP}", que es el separador.`)
  }
  return campos.map((c) => c ?? '').join(SEP)
}

/**
 * Arma el 607 completo.
 *
 * `rncEmisor` es el del contribuyente que REMITE, no el del cliente — es
 * el error mas facil de cometer aqui y el que hace rebotar el archivo
 * entero, no una linea.
 */
export function generar607(rncEmisor: string, periodo: string, ventas: LineaVenta607[]): string {
  validarCabecera(rncEmisor, periodo)

  const cabecera = linea(['607', rncEmisor, periodo, String(ventas.length)], 4)

  const detalle = ventas.map((v) =>
    linea(
      [
        v.rncComprador ?? '', //  1 RNC/Cedula del comprador
        v.tipoIdentificacion, //  2 Tipo de identificacion
        v.ncf, //                 3 NCF
        '', //                    4 NCF modificado (solo notas de credito/debito)
        '1', //                   5 Tipo de ingreso: operaciones no financieras
        v.fechaComprobante, //    6 Fecha del comprobante
        '', //                    7 Fecha de retencion
        monto(v.montoFacturado), //  8 Monto facturado sin impuestos
        monto(v.itbisFacturado), //  9 ITBIS facturado
        '', //                   10 ITBIS retenido por terceros
        '', //                   11 ITBIS percibido (no habilitado por la DGII)
        '', //                   12 Retencion de renta por terceros
        '', //                   13 ISR percibido (no habilitado por la DGII)
        '', //                   14 Impuesto selectivo al consumo
        '', //                   15 Otros impuestos o tasas
        '', //                   16 Propina legal
        monto(v.efectivo), //    17 Efectivo
        monto(v.chequeTransferencia), // 18 Cheque, transferencia o deposito
        monto(v.tarjeta), //     19 Tarjeta
        monto(v.credito), //     20 Venta a credito
        '', //                   21 Bonos o certificados de regalo
        '', //                   22 Permuta
        '', //                   23 Otras formas de venta
      ],
      CAMPOS_607,
    ),
  )

  return [cabecera, ...detalle].join(EOL) + EOL
}

export function generar608(
  rncEmisor: string,
  periodo: string,
  anulados: LineaAnulado608[],
): string {
  validarCabecera(rncEmisor, periodo)

  for (const a of anulados) {
    if (!TIPOS_ANULACION[a.tipoAnulacion]) {
      throw new Error(
        `El NCF ${a.ncf} no tiene un motivo de anulacion valido para la DGII. ` +
          `Debe ser un codigo del 1 al 8, no un texto.`,
      )
    }
  }

  const cabecera = linea(['608', rncEmisor, periodo, String(anulados.length)], 4)
  const detalle = anulados.map((a) =>
    linea([a.ncf, a.fechaComprobante, a.tipoAnulacion], CAMPOS_608),
  )

  return [cabecera, ...detalle].join(EOL) + EOL
}

function validarCabecera(rncEmisor: string, periodo: string): void {
  if (!/^\d{9}$|^\d{11}$/.test(rncEmisor)) {
    throw new Error('El RNC del emisor debe tener 9 digitos (RNC) u 11 (cedula), sin guiones.')
  }
  if (!/^\d{6}$/.test(periodo)) throw new Error('El periodo va como AAAAMM.')
  const mes = Number(periodo.slice(4))
  if (mes < 1 || mes > 12) throw new Error(`El mes ${mes} no existe.`)
}

/**
 * Nombre del archivo que genera la herramienta de la DGII.
 *
 * Sale de las capturas de pantalla de los instructivos, NO de la norma:
 * no esta confirmado que la Oficina Virtual lo valide. Se replica porque
 * es lo que el contador espera ver.
 */
export function nombreArchivo(reporte: '607' | '608', rnc: string, periodo: string): string {
  return `DGII_F_${reporte}_${rnc}_${periodo}.TXT`
}
