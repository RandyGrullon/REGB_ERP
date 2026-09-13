/**
 * Firma digital del e-CF.
 *
 * Vive en su propio paquete y NO en `@regb/operations` porque no es
 * logica pura: necesita Node -criptografia, y la canonicalizacion de
 * XML-. `@regb/operations` corre igual en el navegador, en Electron y en
 * React Native, y meterle esto lo romperia en los tres.
 *
 * ── Lo que la DGII exige, verbatim de su instructivo ──────────────────
 *
 * XMLDSig del W3C, firma **envolvente** (enveloped), **RSA-SHA256**, con
 * canonicalizacion C14N. Dos reglas explicitas del documento:
 *
 *  - `Reference URI` **tiene que ir VACIO** (`URI=""`), para que la firma
 *    aplique al documento completo y no a un fragmento.
 *  - SHA256 es **obligatorio**: "es obligatorio usar este tipo de
 *    funcion al firmar el XML de la e-CF".
 *
 * ── Por que una libreria y no hacerlo a mano ──────────────────────────
 *
 * Por la canonicalizacion. C14N define como se normaliza el XML ANTES de
 * calcularle el hash: orden de atributos, espacios de nombres heredados,
 * saltos de linea, comillas. Dos documentos que se ven identicos pueden
 * canonicalizarse distinto, y entonces el hash no cuadra y la DGII
 * rechaza la firma sin decir por que. Es un estandar de veinte años con
 * casos borde conocidos; escribirlo a mano es garantizarse un fallo
 * intermitente e indepurable.
 *
 * ── Lo que este archivo NO hace ───────────────────────────────────────
 *
 * No guarda ni administra certificados. La clave privada llega como
 * argumento y se usa; de donde sale -un archivo, una boveda, un HSM- es
 * decision de quien llama. Un certificado de e-CF es de **persona
 * fisica** (Ley 126-02), no de la empresa: es material personal y no
 * tiene nada que hacer dentro de esta funcion.
 */

import { X509Certificate } from 'node:crypto'
import { SignedXml } from 'xml-crypto'

/** Los algoritmos que la DGII fija. No son configurables a proposito. */
export const ALGORITMOS = {
  canonicalizacion: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  firma: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
  envolvente: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
} as const

export interface Credencial {
  /** Clave privada en PEM. */
  clavePrivada: string
  /** Certificado en PEM. Viaja dentro del documento, en `X509Data`. */
  certificado: string
}

/**
 * Los elementos vacios que hay en un XML.
 *
 * ── POR QUE EXISTE ESTO ───────────────────────────────────────────────
 *
 * `xml-crypto` calcula el digest sobre su PROPIA serializacion, y esa
 * serializacion escribe los elementos vacios auto-cerrados (`<a/>`).
 * El C14N del W3C dice lo contrario: un elemento vacio SIEMPRE se
 * canonicaliza como `<a></a>`. Resultado: el digest que firma no es el
 * que calculara quien lo reciba, y la firma NO valida.
 *
 * Comprobado sobre este repo: firmando `<ECF><A>1</A><Comprador></Comprador></ECF>`
 * el `DigestValue` corresponde a `<Comprador/>` y no a `<Comprador></Comprador>`,
 * que es lo que sale al recanonicalizar con lxml.
 *
 * Esto NO es teorico para un e-CF dominicano: el esquema exige
 * `<Comprador>` (1..1) y en una venta de mostrador a consumidor final no
 * hay nada que poner dentro. O sea que el caso mas comun de una PYME es
 * justo el que romperia.
 *
 * Se detecta y se lanza en vez de firmar: una firma invalida que sale
 * sin quejarse es peor que no firmar, porque el rechazo de la DGII llega
 * asincrono y horas despues, con la venta ya hecha.
 */
// ── Escaneo lineal: por que aqui NO hay expresiones regulares ───────────
//
//  Todo lo que se recorre en este archivo puede venir de FUERA: un e-CF
//  que otro contribuyente nos manda a las rutas publicas `/api/ecf/...`.
//  El cuerpo llega topado a 4 MB.
//
//  Los regex que habia aqui -del estilo `<Signature[\s\S]*?</Signature>`-
//  son CUADRATICOS cuando la etiqueta de cierre no aparece: el motor
//  reintenta desde cada apertura y recorre el resto entero cada vez.
//  Medido sobre este repo: 344 KB de `'<Signature '` repetido tardan
//  9.6 segundos de CPU. Extrapolando la curva, 4 MB pasan de los veinte
//  minutos, y Node es de un solo hilo: ese POST deja el servidor
//  atendiendo a nadie mas. No hace falta romper nada -basta con un
//  token valido y un archivo grande de basura-.
//
//  Buscar por indice recorre el texto una vez. Es mas codigo y menos
//  bonito; es lineal.

/** Cuanto se acepta de prefijo de espacio de nombres (`ds:`, `xades:`...). */
const MAX_PREFIJO = 64

/**
 * Si en `fin` termina un nombre de etiqueta valido, devuelve donde
 * empieza el `<`. Admite `<Nombre` y `<prefijo:Nombre`.
 *
 * El paso atras esta topado a MAX_PREFIJO a proposito: sin tope, un
 * documento con un prefijo de un megabyte devolveria el mismo coste
 * cuadratico que se acaba de quitar.
 */
function inicioDeEtiqueta(xml: string, fin: number): number {
  if (xml[fin] === '<') return fin
  let i = fin
  const limite = Math.max(0, fin - MAX_PREFIJO)
  while (i > limite) {
    const c = xml.charCodeAt(i - 1)
    const esNombre =
      (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || c === 46
    if (esNombre) {
      i -= 1
      continue
    }
    if (c === 58 /* : */) {
      // El prefijo se consume de una vez; despues solo puede venir '<'.
      i -= 1
      continue
    }
    break
  }
  if (i > 0 && xml[i - 1] === '<') return i - 1
  // Cierre: `</Nombre>` o `</prefijo:Nombre>`.
  if (i > 1 && xml[i - 1] === '/' && xml[i - 2] === '<') return i - 2
  return -1
}

function esEspacio(c: string | undefined): boolean {
  if (c === undefined) return false
  const n = c.charCodeAt(0)
  // 32 espacio, 9 tab, 10 salto, 13 retorno. Se comparan por codigo y no
  // con literales escapados: es la CUARTA vez en este repo que una barra
  // invertida se pierde al generar codigo y el fallo sale lejos de aqui.
  return n === 32 || n === 9 || n === 10 || n === 13
}

/**
 * Posicion del `<` de la siguiente apertura de `nombre`, o -1.
 *
 * Exige que tras el nombre venga un espacio o `>`, para que `Signature`
 * no enganche con `SignatureValue`.
 */
function buscarApertura(xml: string, nombre: string, desde: number): number {
  let i = xml.indexOf(nombre, desde)
  while (i !== -1) {
    const sig = xml[i + nombre.length]
    if (esEspacio(sig) || sig === '>') {
      const ini = inicioDeEtiqueta(xml, i)
      // `inicioDeEtiqueta` tambien reconoce `</`: aqui se busca apertura.
      if (ini !== -1 && xml[ini + 1] !== '/') return ini
    }
    i = xml.indexOf(nombre, i + 1)
  }
  return -1
}

/** Posicion PASADO el `>` del cierre `</nombre>`, o -1. */
function buscarCierre(xml: string, nombre: string, desde: number): number {
  let i = xml.indexOf(nombre, desde)
  while (i !== -1) {
    // Hacia atras debe haber `</` o `</prefijo:`. `inicioDeEtiqueta` deja
    // el cursor en el `<`, asi que el `/` se comprueba aparte.
    const abre = inicioDeEtiqueta(xml, i)
    if (abre !== -1 && xml[abre + 1] === '/') {
      const fin = xml.indexOf('>', i + nombre.length)
      // Entre el nombre y el `>` de un cierre solo caben espacios.
      if (fin !== -1 && xml.slice(i + nombre.length, fin).trim() === '') return fin + 1
    }
    i = xml.indexOf(nombre, i + 1)
  }
  return -1
}

/** El bloque `<Signature ...>...</Signature>` completo, o null. */
export function bloqueDeFirma(xml: string): { inicio: number; fin: number } | null {
  const inicio = buscarApertura(xml, 'Signature', 0)
  if (inicio === -1) return null
  const fin = buscarCierre(xml, 'Signature', inicio)
  return fin === -1 ? null : { inicio, fin }
}

/** Si el documento ya trae firma. */
export function estaFirmado(xml: string): boolean {
  return buscarApertura(xml, 'Signature', 0) !== -1
}

/**
 * El nombre de la etiqueta que empieza en `desde`, o null si ahi no
 * empieza una apertura -un cierre, un comentario, el prologo o un
 * caracter '<' suelto en el texto-.
 */
function nombreDeEtiqueta(xml: string, desde: number): string | null {
  const primero = xml.charCodeAt(desde)
  const esLetra =
    (primero >= 65 && primero <= 90) || (primero >= 97 && primero <= 122) || primero === 95
  if (!esLetra) return null
  let j = desde + 1
  while (j < xml.length) {
    const c = xml.charCodeAt(j)
    const ok =
      (c >= 48 && c <= 57) ||
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      c === 95 ||
      c === 45 ||
      c === 46
    if (!ok) break
    j += 1
  }
  return xml.slice(desde, j)
}

export function elementosVacios(xml: string): string[] {
  // Se quita el bloque de firma: lleva elementos vacios legitimos
  // (`<Transform>`, `<Reference>`...) que no son defecto alguno.
  const firma = bloqueDeFirma(xml)
  const sinFirma = firma === null ? xml : xml.slice(0, firma.inicio) + xml.slice(firma.fin)
  const encontrados = new Set<string>()

  // Recorrido lineal. Los dos `matchAll` que habia aqui usaban una clase
  // de nombre seguida de `[^>]*`, dos repeticiones que compiten por los
  // mismos caracteres: con una etiqueta abierta y sin cierre a la vista,
  // el motor prueba todos los repartos posibles. Medido sobre este repo:
  // 32.000 etiquetas tardaban 11,6 s -y `firmarEcf` llama a esto SIEMPRE,
  // ademas de las rutas publicas de entrada-.
  let i = sinFirma.indexOf('<')
  while (i !== -1) {
    const nombre = nombreDeEtiqueta(sinFirma, i + 1)
    if (nombre === null) {
      i = sinFirma.indexOf('<', i + 1)
      continue
    }
    const cierra = sinFirma.indexOf('>', i + 1 + nombre.length)
    if (cierra === -1) break

    if (sinFirma.slice(i + 1 + nombre.length, cierra).trim() === '/') {
      encontrados.add(nombre) // <Nombre/>
    } else if (sinFirma.startsWith('</' + nombre + '>', cierra + 1)) {
      encontrados.add(nombre) // <Nombre ...></Nombre>
    }
    i = sinFirma.indexOf('<', cierra + 1)
  }
  return [...encontrados]
}

/** Quita cabeceras, pies y saltos del PEM: `X509Certificate` va en base64 pelado. */
export function certificadoEnBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
}

/**
 * Firma un e-CF y devuelve el XML con el `<Signature>` dentro.
 *
 * La firma se inserta como ULTIMO hijo de `<ECF>`, que es donde el
 * esquema la espera: despues de `FechaHoraFirma` hay un
 * `<xs:any minOccurs="1">` y ese hueco es este.
 *
 * Se firma el documento SIN firma previa. Firmar dos veces produce un
 * documento con dos `<Signature>` y ninguno valido.
 */
export function firmarEcf(xml: string, cred: Credencial): string {
  if (estaFirmado(xml)) {
    throw new Error('Ese XML ya viene firmado: firmarlo otra vez lo invalida.')
  }

  // Ver `elementosVacios`: con uno solo, la firma sale invalida y nadie
  // se entera hasta que la DGII la rechaza.
  const vacios = elementosVacios(xml)
  if (vacios.length > 0) {
    throw new Error(
      `No se puede firmar: el documento tiene elementos vacios (${vacios.join(', ')}). ` +
        `La firma saldria invalida porque se calcularia sobre la forma auto-cerrada ` +
        `y quien la verifique canonicalizara la forma con cierre. Ponles contenido u omitelos.`,
    )
  }

  const firmador = new SignedXml({
    privateKey: cred.clavePrivada,
    signatureAlgorithm: ALGORITMOS.firma,
    canonicalizationAlgorithm: ALGORITMOS.canonicalizacion,
    // El certificado viaja dentro del documento para que quien lo reciba
    // pueda verificar la firma sin tenerlo de antes.
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificadoEnBase64(cred.certificado)}</X509Certificate></X509Data>`,
  })

  firmador.addReference({
    xpath: '/*',
    transforms: [ALGORITMOS.envolvente],
    digestAlgorithm: ALGORITMOS.digest,
    // `isEmptyUri` y NO `uri: ''`, aunque parezcan lo mismo.
    //
    // Con `uri: ''` la libreria le AÑADE un atributo `Id="_0"` a la raiz
    // para poder apuntarle... y el XSD de la DGII no admite un `Id` en
    // `<ECF>`: el documento deja de validar. Con `isEmptyUri` emite
    // `URI=""` -que es lo que la DGII exige literalmente- y no toca el
    // documento.
    isEmptyUri: true,
  })

  firmador.computeSignature(xml, {
    // Dentro de la raiz y al final: el hueco que deja el esquema.
    location: { reference: '/*', action: 'append' },
  })

  return firmador.getSignedXml()
}

/**
 * Comprueba que la firma de un e-CF cuadra con su contenido.
 *
 * Se usa con lo que ENTRA: un e-CF que otro nos emite se acusa como "no
 * recibido, motivo 2 (error de firma digital)" cuando esto devuelve
 * false. Tambien sirve para comprobar lo propio antes de mandarlo -un
 * rechazo de la DGII llega asincrono y horas despues-.
 *
 * Devuelve false en vez de lanzar cuando el XML viene roto: un documento
 * malformado es un documento con la firma mala, no un fallo del sistema.
 */
export function verificarFirmaEcf(xmlFirmado: string, certificadoPem: string): boolean {
  try {
    const b = bloqueDeFirma(xmlFirmado)
    if (b === null) return false

    const verificador = new SignedXml({ publicCert: certificadoPem })
    verificador.loadSignature(xmlFirmado.slice(b.inicio, b.fin))
    return verificador.checkSignature(xmlFirmado)
  } catch {
    return false
  }
}

/**
 * El codigo de seguridad: los primeros 6 caracteres del `SignatureValue`.
 *
 * Se extrae aqui, del documento ya firmado, porque antes de firmar
 * sencillamente no existe. De el sale el QR de la representacion
 * impresa, asi que el QR tampoco existe hasta que el e-CF esta firmado.
 */
export function codigoSeguridadDe(xmlFirmado: string): string | null {
  const abre = buscarApertura(xmlFirmado, 'SignatureValue', 0)
  if (abre === -1) return null
  const iniContenido = xmlFirmado.indexOf('>', abre)
  if (iniContenido === -1) return null
  const finBloque = buscarCierre(xmlFirmado, 'SignatureValue', iniContenido)
  if (finBloque === -1) return null
  const cierre = xmlFirmado.lastIndexOf('<', finBloque - 1)
  const limpio = xmlFirmado.slice(iniContenido + 1, cierre).replace(/\s+/g, '')
  return limpio.length < 6 ? null : limpio.slice(0, 6)
}

// El transporte vive aparte pero se exporta desde aqui: firma y envio
// son el mismo trabajo -hablarle a la DGII con el certificado del
// contribuyente- y separarlos en dos importaciones no compra nada.
export * from './transporte.js'

// ── El certificado: quien firmo, y si se le puede creer ──────────────────

/**
 * Lo que se puede saber de un certificado sin salir a internet.
 *
 * ── Por que existe ────────────────────────────────────────────────────
 *
 * `verificarFirmaEcf()` comprueba que el documento NO SE TOCO despues de
 * firmarse. Eso es todo lo que comprueba. Como el certificado viaja
 * dentro del propio documento, cualquiera puede generarse uno
 * autofirmado en diez segundos, firmar con el, y la verificacion da
 * `true`.
 *
 * O sea: la firma prueba integridad, NO identidad. Lo encontro una
 * revision y es exactamente el tipo de cosa que se lee como resuelta
 * porque "la firma verifica".
 *
 * Aqui se saca lo que hace falta para decidir si a ese firmante se le
 * cree: si esta vigente, si es autofirmado, y que RNC dice ser.
 */
export interface DatosCertificado {
  asunto: string
  emisor: string
  validoDesde: Date
  validoHasta: Date
  /** El emisor es el mismo asunto: nadie lo respalda. */
  autofirmado: boolean
  /**
   * RNC o cedula que aparece en el asunto del certificado.
   *
   * Un certificado de e-CF dominicano es de PERSONA FISICA (Ley 126-02)
   * y lleva su cedula. `null` si no se encuentra ninguno.
   */
  documentoIdentidad: string | null
}

export function inspeccionarCertificado(pem: string): DatosCertificado | null {
  try {
    const c = new X509Certificate(pem)

    // El RNC (9) o la cedula (11) van entre los campos del asunto, sin
    // un sitio fijo: unos emisores lo ponen en `serialNumber`, otros
    // dentro del nombre comun. Se busca la secuencia de digitos.
    const digitos = /(?:^|[^0-9])(\d{11}|\d{9})(?:[^0-9]|$)/.exec(c.subject.replace(/-/g, ''))

    return {
      asunto: c.subject,
      emisor: c.issuer,
      validoDesde: new Date(c.validFrom),
      validoHasta: new Date(c.validTo),
      autofirmado: c.issuer === c.subject,
      documentoIdentidad: digitos?.[1] ?? null,
    }
  } catch {
    return null
  }
}

export type NivelConfianza = 'produccion' | 'pruebas'

export interface ProblemaCertificado {
  codigo: 'ilegible' | 'vencido' | 'aun-no-valido' | 'autofirmado' | 'identidad-no-coincide'
  detalle: string
}

/**
 * Si a este certificado se le puede creer para ESTE emisor.
 *
 * `nivel` decide cuanto se exige, y sale del ambiente que ya tiene cada
 * tenant: en produccion un autofirmado no vale nada; en los ambientes de
 * prueba de la DGII si circulan, y rechazarlos impediria certificarse.
 *
 * `rncEsperado` ata el certificado al documento. Sin esta comprobacion,
 * un contribuyente con certificado legitimo puede firmar facturas
 * diciendo ser OTRO -su firma verifica, su certificado es bueno, y el
 * RNC del documento no es el suyo-.
 *
 * Se devuelve la lista de problemas y no un booleano: quien llama
 * necesita poder decir cual fue, y un acuse con el motivo equivocado no
 * le sirve a nadie.
 */
export function problemasDelCertificado(
  pem: string,
  opciones: { ahora: Date; nivel: NivelConfianza; rncEsperado?: string | null },
): ProblemaCertificado[] {
  const datos = inspeccionarCertificado(pem)
  if (datos === null) {
    return [{ codigo: 'ilegible', detalle: 'El certificado no se pudo interpretar.' }]
  }

  const problemas: ProblemaCertificado[] = []
  const { ahora, nivel, rncEsperado } = opciones

  if (ahora > datos.validoHasta) {
    problemas.push({
      codigo: 'vencido',
      detalle: `El certificado vencio el ${datos.validoHasta.toISOString().slice(0, 10)}.`,
    })
  }
  if (ahora < datos.validoDesde) {
    problemas.push({
      codigo: 'aun-no-valido',
      detalle: `El certificado no es valido hasta el ${datos.validoDesde.toISOString().slice(0, 10)}.`,
    })
  }

  if (nivel === 'produccion' && datos.autofirmado) {
    problemas.push({
      codigo: 'autofirmado',
      detalle: 'El certificado se firmo a si mismo: no lo respalda ninguna entidad certificadora.',
    })
  }

  if (
    rncEsperado !== null &&
    rncEsperado !== undefined &&
    rncEsperado !== '' &&
    datos.documentoIdentidad !== null
  ) {
    const esperado = rncEsperado.replace(/\D/g, '')
    if (esperado !== '' && datos.documentoIdentidad !== esperado) {
      problemas.push({
        codigo: 'identidad-no-coincide',
        detalle: `El certificado es de ${datos.documentoIdentidad} y el documento dice venir de ${esperado}.`,
      })
    }
  }

  return problemas
}
