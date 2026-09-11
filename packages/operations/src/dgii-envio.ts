/**
 * Archivos de envio 606, 607 y 608 de la DGII.
 *
 * Formato tomado de la **Norma General 07-2018 sobre Comprobantes
 * Fiscales**, Anexos A (606), B (607) y C (608), y de los instructivos
 * oficiales de la herramienta de envio (607 de dic. 2025, 608 de mar.
 * 2026).
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

/** Campos del detalle del 606, en el orden del Anexo A. */
export const CAMPOS_606 = 23
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
export function nombreArchivo(reporte: '606' | '607' | '608', rnc: string, periodo: string): string {
  return `DGII_F_${reporte}_${rnc}_${periodo}.TXT`
}

// ── 606: compras de bienes y servicios ───────────────────────────────────

/**
 * Clasificacion de costos y gastos del 606 (campo 3).
 *
 * Los once codigos y su descripcion salen de la propia Comunidad de
 * Ayuda de la DGII (CA2438, "¿Cual es la clasificacion de costos y
 * gastos que tiene el formato 606?"), que a su vez remite a la Norma
 * 07-18. La DGII pide el CODIGO de dos digitos: un texto escrito a mano
 * no sirve para declarar, igual que en los motivos de anulacion del 608.
 */
export const TIPOS_GASTO_606: Record<string, string> = {
  '01': 'Gastos de personal',
  '02': 'Gastos por trabajos, suministros y servicios',
  '03': 'Arrendamientos',
  '04': 'Gastos de activos fijos',
  '05': 'Gastos de representacion',
  '06': 'Otras deducciones admitidas',
  '07': 'Gastos financieros',
  '08': 'Gastos extraordinarios',
  '09': 'Compras y gastos que forman parte del costo de venta',
  '10': 'Adquisiciones de activos',
  '11': 'Gastos de seguros',
}

/**
 * Forma de pago del 606 (campo 23).
 *
 * Ojo con la diferencia que confunde a todo el mundo: el 607 reparte el
 * total en COLUMNAS de monto por forma de pago, mientras que el 606 pide
 * UN codigo. Por eso una compra pagada mitad efectivo y mitad
 * transferencia va como '07' (mixto) en el 606 y no se puede partir.
 */
export const FORMAS_PAGO_606: Record<string, string> = {
  '01': 'Efectivo',
  '02': 'Cheque / transferencia / deposito',
  '03': 'Tarjeta de credito o debito',
  '04': 'Compra a credito',
  '05': 'Permuta',
  '06': 'Nota de credito',
  '07': 'Mixto',
}

/**
 * Tipo de retencion en ISR del 606 (campo 17).
 *
 * Solo aplica cuando de verdad se retuvo. La DGII exige que si este
 * campo viene lleno, la fecha de pago (campo 7) tambien lo este -no se
 * puede haber retenido de un pago que todavia no ocurrio-, y eso se
 * valida abajo.
 */
export const TIPOS_RETENCION_ISR_606: Record<string, string> = {
  '01': 'Alquileres',
  '02': 'Honorarios por servicios',
  '03': 'Otras rentas',
  '04': 'Otras rentas (rentas presuntas)',
  '05': 'Intereses pagados a personas juridicas residentes',
  '06': 'Intereses pagados a personas fisicas residentes',
  '07': 'Retencion por proveedores del Estado',
  '08': 'Juegos telefonicos',
  '09': 'Retenciones subsector ganaderia de carne bovina',
}

export function esTipoGasto606(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(TIPOS_GASTO_606, v)
}

export function esFormaPago606(v: string): boolean {
  return Object.prototype.hasOwnProperty.call(FORMAS_PAGO_606, v)
}

export interface LineaCompra606 {
  /** RNC o cedula del PROVEEDOR, solo digitos. */
  rncProveedor: string | null
  tipoIdentificacion: TipoIdentificacion
  /** Codigo 01-11 de TIPOS_GASTO_606. */
  tipoGasto: string
  ncf: string
  /** NCF que se modifica, solo en notas de credito o debito. */
  ncfModificado?: string | null
  /** AAAAMMDD */
  fechaComprobante: string
  /** AAAAMMDD. Vacio si todavia no se ha pagado. */
  fechaPago?: string | null
  /** Parte del monto que corresponde a servicios. */
  montoServicios?: number
  /** Parte del monto que corresponde a bienes. */
  montoBienes?: number
  /** Total facturado sin impuestos. Debe cuadrar con servicios + bienes. */
  montoFacturado: number
  itbisFacturado: number
  itbisRetenido?: number
  itbisProporcionalidad?: number
  itbisAlCosto?: number
  itbisPorAdelantar?: number
  /** Codigo 01-09 de TIPOS_RETENCION_ISR_606. */
  tipoRetencionIsr?: string | null
  retencionRenta?: number
  selectivoConsumo?: number
  otrosImpuestos?: number
  propinaLegal?: number
  /** Codigo 01-07 de FORMAS_PAGO_606. */
  formaPago: string
}

/**
 * Arma el 606 completo.
 *
 * Se valida ANTES de generar, no despues: un archivo que la DGII rechaza
 * es peor que no generarlo, porque el contribuyente se va creyendo que
 * declaro. Las tres cosas que se revisan son las que rebotan de verdad:
 * el codigo de gasto, el de forma de pago, y que la retencion de ISR no
 * venga sin fecha de pago.
 *
 * `rncEmisor` es el del contribuyente que REMITE -el que compro-, no el
 * del proveedor: el mismo error que en el 607 rebota el archivo entero y
 * no una linea.
 */
export function generar606(rncEmisor: string, periodo: string, compras: LineaCompra606[]): string {
  validarCabecera(rncEmisor, periodo)

  for (const c of compras) {
    if (!esTipoGasto606(c.tipoGasto)) {
      throw new Error(
        `El NCF ${c.ncf} no tiene una clasificacion de gasto valida para la DGII. ` +
          `Debe ser un codigo del 01 al 11, no un texto.`,
      )
    }
    if (!esFormaPago606(c.formaPago)) {
      throw new Error(
        `El NCF ${c.ncf} no tiene una forma de pago valida para la DGII. ` +
          `Debe ser un codigo del 01 al 07.`,
      )
    }
    if (c.tipoRetencionIsr) {
      if (!TIPOS_RETENCION_ISR_606[c.tipoRetencionIsr]) {
        throw new Error(`El NCF ${c.ncf} tiene un tipo de retencion de ISR que la DGII no reconoce.`)
      }
      if (!c.fechaPago) {
        throw new Error(
          `El NCF ${c.ncf} declara retencion de ISR pero no tiene fecha de pago. ` +
            `No se puede haber retenido de un pago que todavia no ocurrio.`,
        )
      }
    }
  }

  const cabecera = linea(['606', rncEmisor, periodo, String(compras.length)], 4)

  const detalle = compras.map((c) =>
    linea(
      [
        c.rncProveedor ?? '', //        1 RNC/Cedula del proveedor
        c.tipoIdentificacion, //        2 Tipo de identificacion
        c.tipoGasto, //                 3 Tipo de bienes y servicios comprados
        c.ncf, //                       4 NCF
        c.ncfModificado ?? '', //       5 NCF o documento modificado
        c.fechaComprobante, //          6 Fecha del comprobante
        c.fechaPago ?? '', //           7 Fecha de pago
        monto(c.montoServicios), //     8 Monto facturado en servicios
        monto(c.montoBienes), //        9 Monto facturado en bienes
        monto(c.montoFacturado), //    10 Total monto facturado
        monto(c.itbisFacturado), //    11 ITBIS facturado
        monto(c.itbisRetenido), //     12 ITBIS retenido
        monto(c.itbisProporcionalidad), // 13 ITBIS sujeto a proporcionalidad
        monto(c.itbisAlCosto), //      14 ITBIS llevado al costo
        monto(c.itbisPorAdelantar), // 15 ITBIS por adelantar
        '', //                         16 ITBIS percibido en compras
        c.tipoRetencionIsr ?? '', //   17 Tipo de retencion en ISR
        monto(c.retencionRenta), //    18 Monto de retencion de renta
        '', //                         19 ISR percibido en compras
        monto(c.selectivoConsumo), //  20 Impuesto selectivo al consumo
        monto(c.otrosImpuestos), //    21 Otros impuestos o tasas
        monto(c.propinaLegal), //      22 Monto de propina legal
        c.formaPago, //                23 Forma de pago
      ],
      CAMPOS_606,
    ),
  )

  return [cabecera, ...detalle].join(EOL) + EOL
}
