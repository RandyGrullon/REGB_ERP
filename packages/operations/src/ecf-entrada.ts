/**
 * e-CF que ENTRAN: el lado que casi nadie ve venir.
 *
 * Integrarse con la DGII no es escribir un cliente HTTP. Al postular,
 * el contribuyente declara TRES URL suyas y la DGII -y otros emisores-
 * le pegan a ellas:
 *
 *  - Recepcion: recibe los e-CF que OTROS le emiten.
 *  - Aprobacion: recibe aprobaciones o rechazos comerciales de los e-CF
 *    que el emitio.
 *  - Autenticacion: su PROPIO servicio semilla→token, para que terceros
 *    se autentiquen contra el.
 *
 * En el set de pruebas (pasos 8-11) la DGII manda comprobantes y exige
 * los acuses de vuelta. O sea que sin esta mitad no hay certificacion,
 * por muy bien que se emita.
 *
 * Aqui vive lo puro: que responder y por que. El enrutado multi-tenant
 * y las tablas viven aparte.
 */

// ── El acuse de recibo (ARECF) ───────────────────────────────────────────

/**
 * OJO con la polaridad, que es la segunda trampa de este formato:
 * **0 = recibido (bien), 1 = NO recibido (mal)**. Es al reves de como se
 * lee un booleano, y de como funciona el estado del propio e-CF, donde
 * 1 es "aceptado". Confundirlas manda un acuse que dice lo contrario de
 * lo que paso.
 */
export const ESTADO_ACUSE = {
  RECIBIDO: 0,
  NO_RECIBIDO: 1,
} as const

export type EstadoAcuse = (typeof ESTADO_ACUSE)[keyof typeof ESTADO_ACUSE]

/**
 * Por que no se recibio. Solo aplica cuando el estado es NO_RECIBIDO.
 *
 * Son estos cuatro y nada mas: un motivo inventado invalida el acuse.
 */
export type MotivoNoRecibido = 1 | 2 | 3 | 4

export const MOTIVOS_NO_RECIBIDO: Record<MotivoNoRecibido, string> = {
  1: 'Error de especificacion',
  2: 'Error de firma digital',
  3: 'Envio duplicado',
  4: 'RNC comprador no corresponde',
}

export interface Acuse {
  estado: EstadoAcuse
  /** Presente solo si no se recibio. */
  codigoMotivo?: MotivoNoRecibido
  motivo?: string
}

export interface RevisionEntrante {
  /** El XML se pudo interpretar contra el XSD. */
  xmlValido: boolean
  /** La firma digital verifica. */
  firmaValida: boolean
  /** Ya habiamos recibido ESE e-NCF de ESE emisor. */
  duplicado: boolean
  /** El RNC del comprador que trae el documento es el nuestro. */
  rncCompradorCorrecto: boolean
}

/**
 * Que acuse devolver.
 *
 * El acuse NO dice si el comprobante se acepta comercialmente -eso es la
 * aprobacion comercial, que es otro documento-. Dice unicamente si
 * llego bien o no llego.
 *
 * El ORDEN de las comprobaciones no es decorativo: si el XML no se pudo
 * interpretar, no se puede leer el RNC del comprador ni saber si es
 * duplicado, asi que preguntarlo despues seria preguntar sobre datos que
 * no existen. Cada motivo asume que los anteriores pasaron.
 */
export function decidirAcuse(r: RevisionEntrante): Acuse {
  // El codigo va tipado a los cuatro que existen, no a `number`: asi el
  // compilador garantiza que siempre hay un texto que acompañe al codigo
  // y no se puede colar un motivo inventado, que invalidaria el acuse.
  const rechazo = (codigo: MotivoNoRecibido): Acuse => ({
    estado: ESTADO_ACUSE.NO_RECIBIDO,
    codigoMotivo: codigo,
    motivo: MOTIVOS_NO_RECIBIDO[codigo],
  })

  if (!r.xmlValido) return rechazo(1)
  if (!r.firmaValida) return rechazo(2)
  if (r.duplicado) return rechazo(3)
  if (!r.rncCompradorCorrecto) return rechazo(4)

  return { estado: ESTADO_ACUSE.RECIBIDO }
}

export function seRecibio(a: Acuse): boolean {
  return a.estado === ESTADO_ACUSE.RECIBIDO
}

// ── El enrutado multi-tenant, que es el problema de verdad ───────────────

/**
 * A quien va dirigido un e-CF que entra.
 *
 * Este es el punto donde un ERP multi-tenant se diferencia de una
 * integracion de una sola empresa. La DGII le pega a UNA URL; nosotros
 * servimos a muchos RNC desde el mismo despliegue. Hay que saber de
 * QUIEN es el comprobante antes de guardarlo.
 *
 * Lo que NO se puede hacer: leer el RNC del comprador que viene DENTRO
 * del XML y usarlo para elegir el tenant. Eso es exactamente el patron
 * que la puerta F0 prohibe -"tenant_id nunca se lee de body"- y aqui
 * seria peor que en una pantalla: cualquiera que sepa el RNC de un
 * cliente podria escribirle facturas en su cuenta.
 *
 * Lo que si: cada tenant declara a la DGII una URL propia que lleva un
 * token opaco e irrepetible. El token identifica Y autentica, igual que
 * el enlace del portal del cliente (`portal-cliente/[token]`), que es el
 * precedente del repo para una ruta publica.
 *
 * Y despues, defensa en profundidad: el RNC del documento tiene que
 * coincidir con el del tenant al que apunta el token. Si no coincide,
 * el acuse sale con motivo 4 y no se guarda nada.
 */
export interface Destinatario {
  /** Tenant al que apunta el token de la URL. */
  tenantId: string
  /** RNC de ese tenant, en digitos. */
  rncTenant: string
}

/**
 * Si el documento va de verdad para ese tenant.
 *
 * Se comparan solo digitos: la DGII escribe el RNC sin guiones, pero un
 * emisor descuidado puede mandarlo con ellos y rechazar por formato una
 * factura legitima seria peor que aceptarla.
 */
export function esParaEsteTenant(rncEnDocumento: string, d: Destinatario): boolean {
  const a = rncEnDocumento.replace(/\D/g, '')
  const b = d.rncTenant.replace(/\D/g, '')
  return a !== '' && a === b
}

// ── El token de la URL ───────────────────────────────────────────────────

/**
 * Largo minimo del token que va en la URL declarada a la DGII.
 *
 * 32 caracteres hex = 128 bits. No es un id bonito: es la unica cosa
 * que separa las facturas de un cliente de las de otro en una ruta que,
 * por definicion, es publica y sin sesion.
 */
export const LARGO_TOKEN_ENDPOINT = 32

export function tokenValido(token: string): boolean {
  return new RegExp(`^[a-f0-9]{${LARGO_TOKEN_ENDPOINT},}$`).test(token)
}

/**
 * Las tres URL que el tenant declara en su postulacion.
 *
 * Se arman aqui y no en la pantalla para que el texto que el
 * contribuyente copia al formulario de la DGII salga de un solo sitio:
 * si una se escribe a mano y queda mal, la DGII le pega a una ruta que
 * no existe y la certificacion se cae en el paso 8 sin explicacion.
 */
export interface UrlsDeclaradas {
  recepcion: string
  aprobacion: string
  autenticacion: string
}

export function urlsParaDeclarar(base: string, token: string): UrlsDeclaradas {
  const raiz = base.replace(/\/+$/, '')
  return {
    recepcion: `${raiz}/api/ecf/${token}/recepcion`,
    aprobacion: `${raiz}/api/ecf/${token}/aprobacion`,
    autenticacion: `${raiz}/api/ecf/${token}/autenticacion`,
  }
}

// ── El acuse, como XML ───────────────────────────────────────────────────

/**
 * Lo que se extrae de un e-CF que entra.
 *
 * Se leen SOLO los campos que hacen falta para decidir el acuse y
 * guardarlo. No se interpreta el documento entero: lo que llega se
 * archiva tal cual y lo demas se lee cuando alguien lo necesite. Menos
 * codigo que mantener contra un esquema de 235 elementos que cambia.
 */
export interface EcfEntrante {
  encf: string | null
  rncEmisor: string | null
  rncComprador: string | null
  montoTotal: number | null
}

/**
 * El contenido de una etiqueta, buscando por texto y NO con un regex
 * construido al vuelo.
 *
 * Se hace asi por una razon concreta y ya vivida DOS veces en este
 * repo: una barra invertida dentro de una plantilla de JavaScript se
 * pierde antes de llegar a donde importa. `new RegExp(`<\w+:?...`)`
 * escrito con una sola barra deja de buscar `\w` y busca la letra "w",
 * y el patron nunca casa. Paso antes con el `'\D'` de la consulta del
 * RNC en la ruta del 607 -que hacia rebotar el archivo entero- y volvio
 * a pasar aqui, donde dejaba TODOS los campos del e-CF entrante en nulo
 * y contestaba "error de especificacion" a documentos perfectos.
 *
 * Buscando por indices no hay barras que perder. Ademas tolera el
 * prefijo de espacio de nombres (`ns:eNCF`), que un emisor puede usar.
 */
/**
 * Quita lo que NO es contenido: comentarios y el prologo.
 *
 * Sin esto el parser lee dentro de un comentario. Un emisor podia
 * mandar `<!-- <eNCF>E310000000001</eNCF> -->` antes del verdadero y el
 * documento se archivaba con el e-NCF del comentario: mismo efecto que
 * suplantar el comprobante, sin romper la firma -un comentario es parte
 * del documento firmado, asi que la firma sigue cuadrando-.
 *
 * Comprobado antes de arreglarlo: con la trampa puesta, el parser
 * devolvia el del comentario y no el real.
 */
function sinComentarios(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '')
}

function etiquetaDe(xml: string, nombre: string): string | null {
  const cierre = `</${nombre}>`
  const fin = xml.indexOf(cierre)
  if (fin === -1) return null

  // El inicio es la ultima apertura antes del cierre: asi un `<ns:eNCF>`
  // se encuentra igual que un `<eNCF>`.
  const abre = xml.lastIndexOf(`${nombre}>`, fin - 1)
  if (abre === -1 || abre >= fin) return null
  const desde = abre + nombre.length + 1

  const v = xml.slice(desde, fin).trim()
  return v === '' ? null : v
}

export function leerEcfEntrante(crudo: string): EcfEntrante {
  const xml = sinComentarios(crudo)
  const monto = etiquetaDe(xml, 'MontoTotal')
  const n = monto === null ? NaN : Number(monto)
  return {
    encf: etiquetaDe(xml, 'eNCF'),
    rncEmisor: etiquetaDe(xml, 'RNCEmisor'),
    rncComprador: etiquetaDe(xml, 'RNCComprador'),
    montoTotal: Number.isFinite(n) ? n : null,
  }
}

export interface DatosAcuse {
  rncEmisor: string
  rncComprador: string
  encf: string
  /** DD-MM-AAAA HH:mm:ss */
  fechaHora: string
}

/**
 * El XML del acuse de recibo (ARECF), contra el esquema oficial.
 *
 * El orden es el del XSD -`xs:sequence` es ordenado- y
 * `CodigoMotivoNoRecibido` va DESPUES de `Estado` y solo cuando no se
 * recibio: emitirlo siempre invalida el documento.
 *
 * Un detalle util de los esquemas del acuse: el e-NCF admite 13, 11 o 9
 * caracteres, no solo los 13 del e-CF. Es asi porque tambien se acusan
 * referencias a comprobantes de papel.
 */
export function xmlAcuse(d: DatosAcuse, acuse: Acuse): string {
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ARECF>',
    '<DetalleAcusedeRecibo>',
    '<Version>1.0</Version>',
    `<RNCEmisor>${esc(d.rncEmisor)}</RNCEmisor>`,
    `<RNCComprador>${esc(d.rncComprador)}</RNCComprador>`,
    `<eNCF>${esc(d.encf)}</eNCF>`,
    `<Estado>${acuse.estado}</Estado>`,
    acuse.codigoMotivo === undefined
      ? ''
      : `<CodigoMotivoNoRecibido>${acuse.codigoMotivo}</CodigoMotivoNoRecibido>`,
    `<FechaHoraAcuseRecibo>${esc(d.fechaHora)}</FechaHoraAcuseRecibo>`,
    '</DetalleAcusedeRecibo>',
    '</ARECF>',
  ]
    .filter((x) => x !== '')
    .join('')
}
