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
export function elementosVacios(xml: string): string[] {
  const sinFirma = xml.replace(/<(\w+:)?Signature[\s>][\s\S]*?<\/(\w+:)?Signature>/g, '')
  const encontrados = new Set<string>()
  for (const m of sinFirma.matchAll(/<([A-Za-z_][\w.-]*)\s*\/>/g)) encontrados.add(m[1]!)
  for (const m of sinFirma.matchAll(/<([A-Za-z_][\w.-]*)[^>]*><\/\1>/g)) encontrados.add(m[1]!)
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
  if (/<(\w+:)?Signature[\s>]/.test(xml)) {
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
    const m = /<(\w+:)?Signature[\s>][\s\S]*<\/(\w+:)?Signature>/.exec(xmlFirmado)
    if (!m) return false

    const verificador = new SignedXml({ publicCert: certificadoPem })
    verificador.loadSignature(m[0])
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
  const m = /<(\w+:)?SignatureValue[^>]*>([\s\S]*?)<\/(\w+:)?SignatureValue>/.exec(xmlFirmado)
  if (!m?.[2]) return null
  const limpio = m[2].replace(/\s+/g, '')
  return limpio.length < 6 ? null : limpio.slice(0, 6)
}

// El transporte vive aparte pero se exporta desde aqui: firma y envio
// son el mismo trabajo -hablarle a la DGII con el certificado del
// contribuyente- y separarlos en dos importaciones no compra nada.
export * from './transporte.js'
