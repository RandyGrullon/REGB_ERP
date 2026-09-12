import { describe, expect, it, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ALGORITMOS,
  certificadoEnBase64,
  codigoSeguridadDe,
  elementosVacios,
  firmarEcf,
  inspeccionarCertificado,
  problemasDelCertificado,
  verificarFirmaEcf,
} from './index.js'

/**
 * Se firma con un certificado AUTOFIRMADO generado al vuelo.
 *
 * No sirve para la DGII -alli hace falta uno de persona fisica emitido
 * bajo la Ley 126-02- pero prueba lo unico que se puede probar sin el:
 * que la firma que producimos verifica contra su propio certificado y
 * que el documento no se mutila al firmarlo.
 */
let clavePrivada = ''
let certificado = ''

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ecf-firma-'))
  const clave = join(dir, 'clave.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', clave, '-out', cert,
    '-days', '1', '-nodes',
    '-subj', '/C=DO/O=Prueba/CN=Prueba',
    // openssl escupe su barra de progreso por stderr y ensucia la salida
    // de las pruebas sin aportar nada.
  ], { stdio: 'ignore' })
  clavePrivada = readFileSync(clave, 'utf8')
  certificado = readFileSync(cert, 'utf8')
})

const DOC =
  '<?xml version="1.0" encoding="UTF-8"?><ECF><Encabezado><Version>1.0</Version>' +
  '<Comprador><RazonSocialComprador>CONSUMIDOR FINAL</RazonSocialComprador></Comprador>' +
  '</Encabezado><FechaHoraFirma>11-09-2026 09:05:03</FechaHoraFirma></ECF>'

describe('Los algoritmos son los que fija la DGII', () => {
  it('RSA-SHA256, C14N y firma envolvente', () => {
    expect(ALGORITMOS.firma).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256')
    expect(ALGORITMOS.canonicalizacion).toBe('http://www.w3.org/TR/2001/REC-xml-c14n-20010315')
    expect(ALGORITMOS.digest).toBe('http://www.w3.org/2001/04/xmlenc#sha256')
    expect(ALGORITMOS.envolvente).toBe('http://www.w3.org/2000/09/xmldsig#enveloped-signature')
  })
})

describe('Firmar y verificar', () => {
  it('lo que firmamos verifica contra su certificado', () => {
    const firmado = firmarEcf(DOC, { clavePrivada, certificado })
    expect(verificarFirmaEcf(firmado, certificado)).toBe(true)
  })

  it('la firma va DENTRO de ECF y al final', () => {
    const firmado = firmarEcf(DOC, { clavePrivada, certificado })
    expect(firmado.endsWith('</ECF>')).toBe(true)
    expect(firmado.indexOf('<Signature')).toBeGreaterThan(firmado.indexOf('<FechaHoraFirma>'))
  })

  it('el certificado viaja dentro, para que el receptor pueda verificar', () => {
    const firmado = firmarEcf(DOC, { clavePrivada, certificado })
    expect(firmado).toContain('<X509Certificate>')
    expect(firmado).toContain(certificadoEnBase64(certificado).slice(0, 40))
  })

  it('la referencia va con URI vacio, como exige la DGII', () => {
    expect(firmarEcf(DOC, { clavePrivada, certificado })).toContain('<Reference URI="">')
  })

  it('NO le mete un Id a la raiz: el XSD de la DGII no lo admite', () => {
    // Con `uri: ''` en vez de `isEmptyUri`, xml-crypto añade Id="_0" a
    // <ECF> y el documento deja de validar contra el esquema.
    expect(/<ECF[^>]*Id=/.test(firmarEcf(DOC, { clavePrivada, certificado }))).toBe(false)
  })

  it('tocar el documento despues de firmarlo invalida la firma', () => {
    const firmado = firmarEcf(DOC, { clavePrivada, certificado })
    const manipulado = firmado.replace('CONSUMIDOR FINAL', 'OTRO COMPRADOR')
    expect(verificarFirmaEcf(manipulado, certificado)).toBe(false)
  })

  it('un XML roto da firma invalida, no una excepcion', () => {
    expect(verificarFirmaEcf('<ECF>sin firma', certificado)).toBe(false)
    expect(verificarFirmaEcf('', certificado)).toBe(false)
  })

  it('firmar dos veces se rechaza', () => {
    const firmado = firmarEcf(DOC, { clavePrivada, certificado })
    expect(() => firmarEcf(firmado, { clavePrivada, certificado })).toThrow(/ya viene firmado/)
  })
})

describe('Los elementos vacios, que rompen la firma en silencio', () => {
  it('detecta la forma con cierre y la auto-cerrada', () => {
    expect(elementosVacios('<ECF><Comprador></Comprador></ECF>')).toEqual(['Comprador'])
    expect(elementosVacios('<ECF><Comprador/></ECF>')).toEqual(['Comprador'])
  })

  it('no confunde un elemento con contenido', () => {
    expect(elementosVacios('<ECF><A>1</A></ECF>')).toEqual([])
  })

  it('ignora la propia firma -tiene elementos vacios legitimos-', () => {
    const firmado = firmarEcf(DOC, { clavePrivada, certificado })
    expect(elementosVacios(firmado)).toEqual([])
  })

  it('se NIEGA a firmar un documento con elementos vacios', () => {
    // Es la trampa que costo encontrar: xml-crypto calcula el digest
    // sobre `<a/>` mientras que quien verifica canonicaliza `<a></a>`.
    // La firma sale invalida y nadie se entera hasta el rechazo de la
    // DGII, horas despues y con la venta ya hecha.
    expect(() => firmarEcf('<ECF><Comprador></Comprador></ECF>', { clavePrivada, certificado })).toThrow(
      /elementos vacios \(Comprador\)/,
    )
  })
})

describe('El codigo de seguridad', () => {
  it('son los primeros seis del SignatureValue', () => {
    const firmado = firmarEcf(DOC, { clavePrivada, certificado })
    const cod = codigoSeguridadDe(firmado)
    expect(cod).toHaveLength(6)
    const valor = /<SignatureValue[^>]*>([\s\S]*?)<\/SignatureValue>/.exec(firmado)![1]!
    expect(valor.replace(/\s+/g, '').startsWith(cod!)).toBe(true)
  })

  it('sin firma no hay codigo: el QR no existe hasta firmar', () => {
    expect(codigoSeguridadDe(DOC)).toBeNull()
  })
})

describe('La firma prueba INTEGRIDAD, no identidad', () => {
  /**
   * Un instante DENTRO de la vigencia del certificado de prueba.
   *
   * No se fija una fecha a mano: el certificado se genera al correr las
   * pruebas, asi que cualquier fecha escrita queda fuera de su ventana
   * segun la hora del dia. Se saca de su propia vigencia.
   */
  const dentroDeVigencia = () => {
    const d = inspeccionarCertificado(certificado)!
    return new Date((d.validoDesde.getTime() + d.validoHasta.getTime()) / 2)
  }

  it('un autofirmado da firma valida: por eso hace falta mirar el certificado', () => {
    // Este es el hallazgo. `verificarFirmaEcf` dice true porque el
    // documento no se toco -y eso es cierto-. Lo que no dice es quien
    // firmo: el certificado se lo hizo el propio firmante.
    const firmado = firmarEcf(DOC, { clavePrivada, certificado })
    expect(verificarFirmaEcf(firmado, certificado)).toBe(true)
    expect(inspeccionarCertificado(certificado)?.autofirmado).toBe(true)
  })

  it('en PRODUCCION un autofirmado no pasa', () => {
    const p = problemasDelCertificado(certificado, { ahora: dentroDeVigencia(), nivel: 'produccion' })
    expect(p.map((x) => x.codigo)).toContain('autofirmado')
  })

  it('en los ambientes de prueba SI se tolera', () => {
    // En testecf y certecf circulan autofirmados; rechazarlos impediria
    // certificarse, que es justo el paso que hay que dar.
    expect(problemasDelCertificado(certificado, { ahora: dentroDeVigencia(), nivel: 'pruebas' })).toEqual([])
  })

  it('un certificado vencido no pasa en ningun ambiente', () => {
    const p = problemasDelCertificado(certificado, {
      ahora: new Date('2030-01-01T00:00:00Z'),
      nivel: 'pruebas',
    })
    expect(p.map((x) => x.codigo)).toContain('vencido')
  })

  it('uno que aun no empieza tampoco', () => {
    const p = problemasDelCertificado(certificado, {
      ahora: new Date('2020-01-01T00:00:00Z'),
      nivel: 'pruebas',
    })
    expect(p.map((x) => x.codigo)).toContain('aun-no-valido')
  })

  it('basura devuelve "ilegible", no explota', () => {
    expect(inspeccionarCertificado('no soy un certificado')).toBeNull()
    expect(
      problemasDelCertificado('x', { ahora: dentroDeVigencia(), nivel: 'pruebas' }).map((p) => p.codigo),
    ).toEqual(['ilegible'])
  })

  it('sin identidad en el certificado no se inventa una coincidencia', () => {
    // El de prueba no lleva cedula en el asunto: no se puede comprobar
    // contra quien, y afirmar que coincide seria mentir.
    expect(inspeccionarCertificado(certificado)?.documentoIdentidad).toBeNull()
    const p = problemasDelCertificado(certificado, {
      ahora: dentroDeVigencia(),
      nivel: 'pruebas',
      rncEsperado: '131223345',
    })
    expect(p.map((x) => x.codigo)).not.toContain('identidad-no-coincide')
  })
})
