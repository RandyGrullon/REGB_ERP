/**
 * Hablarle a la DGII: autenticacion, envio y consulta.
 *
 * Vive junto a la firma porque las dos cosas son lo mismo -Node, red y
 * el certificado del contribuyente- y separarlas en dos paquetes con la
 * misma dependencia no compra nada.
 *
 * ── Lo que rompe la primera integracion de todo el mundo ──────────────
 *
 * 1. **El envio es `multipart/form-data` con un campo `xml`**, NO un
 *    POST con el XML en el cuerpo. Es lo primero que falla.
 * 2. **Las facturas de consumo por debajo de RD$250,000 van a OTRO
 *    DOMINIO** (`fc.dgii.gov.do`), no a `ecf.dgii.gov.do`. Mandarlas al
 *    servicio normal las rechaza con un mensaje que no lo explica.
 * 3. **La autenticacion es en dos pasos**: se pide una semilla, se
 *    FIRMA esa semilla con el certificado, y se cambia por un token.
 *    No hay usuario y contraseña.
 * 4. **El envio no responde aceptado/rechazado.** Devuelve un `trackId`
 *    y ya: el resultado se consulta despues. Tratar la respuesta del
 *    POST como el veredicto es dar por buena una factura que la DGII
 *    todavia no miro.
 *
 * ── Lo que NO se ha probado ───────────────────────────────────────────
 *
 * ⚠️ Ninguna de estas llamadas se ha hecho contra un servidor real de la
 * DGII. Hace falta un certificado digital de persona fisica para dar el
 * primer paso. Las URL, los verbos y los formatos salen de la
 * Descripcion Tecnica oficial; lo que responde de verdad, no se sabe.
 */

import { firmarEcf, type Credencial } from './index.js'

export type Ambiente = 'testecf' | 'certecf' | 'ecf'

/**
 * Los dos dominios. Que sean distintos NO es un detalle: es la causa
 * numero uno de que una factura de consumo se pierda.
 */
export const DOMINIO_ECF = 'https://ecf.dgii.gov.do'
export const DOMINIO_FC = 'https://fc.dgii.gov.do'

/** Las rutas, verbatim de la Descripcion Tecnica de la DGII. */
export const RUTAS = {
  semilla: 'autenticacion/api/autenticacion/semilla',
  validarSemilla: 'autenticacion/api/autenticacion/validarsemilla',
  recepcionEcf: 'recepcion/api/facturaselectronicas',
  recepcionResumen: 'recepcionfc/api/recepcion/ecf',
  consultaResultado: 'consultaresultado/api/consultas/estado',
  consultaResumen: 'consultarfce/api/Consultas/Consulta',
  aprobacionComercial: 'aprobacioncomercial/api/aprobacioncomercial',
  anulacionRangos: 'anulacionrangos/api/operaciones/anularrango',
  directorio: 'consultadirectorio/api/consultas/listado',
} as const

export function urlEcf(ambiente: Ambiente, ruta: string): string {
  return `${DOMINIO_ECF}/${ambiente}/${ruta}`
}

/** El resumen (RFCE) vive en otro dominio. Por eso hay dos funciones y no una. */
export function urlFc(ambiente: Ambiente, ruta: string): string {
  return `${DOMINIO_FC}/${ambiente}/${ruta}`
}

// ── Autenticacion ────────────────────────────────────────────────────────

export interface Token {
  valor: string
  /** Cuando deja de servir. Sale de la respuesta, no se asume. */
  expira: Date
}

/**
 * Si al token le queda cuerda.
 *
 * Se descuenta un margen porque entre pedir el token y que la DGII
 * procese el envio pasa tiempo: uno que expira en diez segundos ya no
 * sirve para nada. El documento dice que dura "1 hora por el momento",
 * o sea que la duracion NO es un contrato estable y no se codifica.
 */
export function tokenVigente(t: Token, ahora: Date, margenSegundos = 60): boolean {
  return t.expira.getTime() - ahora.getTime() > margenSegundos * 1000
}

/** La semilla llega como XML `<SemillaModel>` con `valor` y `fecha`. */
export function leerSemilla(xml: string): string | null {
  const m = /<valor>([\s\S]*?)<\/valor>/i.exec(xml)
  return m?.[1]?.trim() ?? null
}

/** `{ token, expira, expedido }` es lo que devuelve validarsemilla. */
export function leerToken(json: unknown): Token | null {
  if (typeof json !== 'object' || json === null) return null
  const o = json as Record<string, unknown>
  const valor = o['token']
  const expira = o['expira']
  if (typeof valor !== 'string' || valor === '') return null
  const fecha = typeof expira === 'string' ? new Date(expira) : null
  return {
    valor,
    // Sin fecha utilizable se asume una hora, que es lo que dice el
    // documento hoy. Se prefiere un token que caduque de mas a uno que
    // se de por bueno para siempre.
    expira: fecha && !Number.isNaN(fecha.getTime()) ? fecha : new Date(Date.now() + 3_600_000),
  }
}

// ── Envio ────────────────────────────────────────────────────────────────

export interface RespuestaEnvio {
  trackId: string | null
  error: string | null
  mensaje: string | null
}

/**
 * Interpreta la respuesta del POST de recepcion.
 *
 * OJO: esto NO dice si el comprobante se acepto. Devuelve un `trackId`
 * que es el acuse de RECIBO, y el veredicto se consulta despues. La
 * propia DGII estima unos 200 ms de validacion, pero es asincrono igual.
 */
export function leerRespuestaEnvio(json: unknown): RespuestaEnvio {
  if (typeof json !== 'object' || json === null) {
    return { trackId: null, error: 'respuesta ilegible', mensaje: null }
  }
  const o = json as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  return {
    trackId: texto(o['trackId'] ?? o['trackid']),
    error: texto(o['error']),
    mensaje: texto(o['mensaje']),
  }
}

/**
 * El cuerpo del envio: `multipart/form-data` con un campo llamado `xml`.
 *
 * Se arma con `FormData` y `Blob` nativos -Node 18+- para que el
 * `boundary` lo ponga el runtime. Escribirlo a mano es otra forma
 * clasica de que la DGII conteste un 400 sin explicacion.
 *
 * El nombre de archivo es `RNC+eNCF.xml`, como manda la norma tecnica.
 */
export function cuerpoEnvio(xmlFirmado: string, nombreArchivo: string): FormData {
  const fd = new FormData()
  fd.append('xml', new Blob([xmlFirmado], { type: 'text/xml' }), nombreArchivo)
  return fd
}

// ── El cliente ───────────────────────────────────────────────────────────

/** `fetch` inyectable: asi las pruebas no necesitan red ni certificado. */
export type Fetch = typeof globalThis.fetch

export interface OpcionesCliente {
  ambiente: Ambiente
  credencial: Credencial
  fetch?: Fetch
}

export class ClienteDgii {
  private token: Token | null = null
  private readonly hacerFetch: Fetch

  constructor(private readonly op: OpcionesCliente) {
    this.hacerFetch = op.fetch ?? globalThis.fetch
  }

  /**
   * Devuelve un token util, pidiendo uno nuevo solo si hace falta.
   *
   * Se cachea porque el flujo son DOS llamadas mas una firma: hacerlo en
   * cada factura triplicaria el trafico y el tiempo de una caja que esta
   * cobrando.
   */
  async obtenerToken(ahora: Date = new Date()): Promise<Token> {
    if (this.token && tokenVigente(this.token, ahora)) return this.token

    const rSemilla = await this.hacerFetch(urlEcf(this.op.ambiente, RUTAS.semilla))
    if (!rSemilla.ok) throw new Error(`La DGII no dio semilla (HTTP ${rSemilla.status}).`)

    const xmlSemilla = await rSemilla.text()
    if (leerSemilla(xmlSemilla) === null) {
      throw new Error('La semilla vino sin <valor>: no se puede firmar.')
    }

    // Se firma la SEMILLA COMPLETA, no solo su valor: es un documento
    // XML y la firma va sobre el documento.
    const firmada = firmarEcf(xmlSemilla, this.op.credencial)

    const fd = new FormData()
    fd.append('xml', new Blob([firmada], { type: 'text/xml' }), 'semilla.xml')

    const rToken = await this.hacerFetch(urlEcf(this.op.ambiente, RUTAS.validarSemilla), {
      method: 'POST',
      body: fd,
    })
    if (!rToken.ok) throw new Error(`La DGII rechazo la semilla firmada (HTTP ${rToken.status}).`)

    const token = leerToken(await rToken.json())
    if (token === null) throw new Error('La DGII no devolvio un token utilizable.')

    this.token = token
    return token
  }

  /**
   * Manda un e-CF ya firmado.
   *
   * `porResumen` decide el DOMINIO, no solo la ruta. Quien llama lo sabe
   * porque ya calculo la ruta con `rutaDeEnvio()` al armar el
   * documento: aqui no se vuelve a decidir para que no haya dos sitios
   * que puedan discrepar.
   */
  async enviar(
    xmlFirmado: string,
    nombreArchivo: string,
    porResumen: boolean,
  ): Promise<RespuestaEnvio> {
    const token = await this.obtenerToken()
    const url = porResumen
      ? urlFc(this.op.ambiente, RUTAS.recepcionResumen)
      : urlEcf(this.op.ambiente, RUTAS.recepcionEcf)

    const r = await this.hacerFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.valor}` },
      body: cuerpoEnvio(xmlFirmado, nombreArchivo),
    })

    // Un 4xx/5xx tambien trae cuerpo con el motivo: se lee igual en vez
    // de tirar solo el codigo.
    const json = await r.json().catch(() => null)
    const resp = leerRespuestaEnvio(json)

    if (r.ok) return resp

    // Cuando falla, el CODIGO HTTP manda. Un 503 con una pagina de error
    // de HTML delante no se puede reportar como "respuesta ilegible": eso
    // esconde que el servicio esta caido, que es lo unico accionable.
    // Si ademas la DGII explico el motivo, se conserva al lado.
    const motivoDgii = resp.error !== null && resp.error !== 'respuesta ilegible' ? resp.error : null
    return {
      trackId: null,
      error: motivoDgii ?? `HTTP ${r.status}`,
      mensaje: motivoDgii === null ? resp.mensaje : `HTTP ${r.status}`,
    }
  }

  /**
   * El veredicto, por trackId. Es lo que dice si la factura vale.
   *
   * `porResumen` elige el DOMINIO, igual que en el envio. Sin esto, el
   * veredicto del CAMINO PRINCIPAL de una PYME -el resumen- se pedia al
   * dominio del e-CF completo, donde ese trackId no existe: toda factura
   * de consumo por debajo de RD$250,000 quedaba sin poder confirmarse.
   */
  async consultarResultado(trackId: string, porResumen = false): Promise<unknown> {
    const token = await this.obtenerToken()
    const base = porResumen
      ? urlFc(this.op.ambiente, RUTAS.consultaResumen)
      : urlEcf(this.op.ambiente, RUTAS.consultaResultado)
    const url = `${base}?trackid=${encodeURIComponent(trackId)}`
    const r = await this.hacerFetch(url, {
      headers: { Authorization: `Bearer ${token.valor}` },
    })
    if (!r.ok) throw new Error(`No se pudo consultar el trackId (HTTP ${r.status}).`)
    return r.json()
  }
}
