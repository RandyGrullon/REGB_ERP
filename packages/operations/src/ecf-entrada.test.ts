import { describe, expect, it } from 'vitest'
import {
  ESTADO_ACUSE,
  leerEcfEntrante,
  LARGO_TOKEN_ENDPOINT,
  MOTIVOS_NO_RECIBIDO,
  decidirAcuse,
  esParaEsteTenant,
  seRecibio,
  tokenValido,
  urlsParaDeclarar,
  type RevisionEntrante,
} from './ecf-entrada.js'

const todoBien: RevisionEntrante = {
  xmlValido: true,
  firmaValida: true,
  duplicado: false,
  rncCompradorCorrecto: true,
}

describe('El acuse y su polaridad al reves', () => {
  it('recibido es CERO, no uno', () => {
    expect(ESTADO_ACUSE.RECIBIDO).toBe(0)
    expect(ESTADO_ACUSE.NO_RECIBIDO).toBe(1)
  })

  it('un e-CF sano se acusa como recibido y sin motivo', () => {
    const a = decidirAcuse(todoBien)
    expect(a.estado).toBe(ESTADO_ACUSE.RECIBIDO)
    expect(a.codigoMotivo).toBeUndefined()
    expect(seRecibio(a)).toBe(true)
  })

  it('son exactamente cuatro motivos', () => {
    expect(Object.keys(MOTIVOS_NO_RECIBIDO)).toHaveLength(4)
  })

  it('cada rechazo lleva su codigo y su texto', () => {
    const a = decidirAcuse({ ...todoBien, firmaValida: false })
    expect(a.estado).toBe(ESTADO_ACUSE.NO_RECIBIDO)
    expect(a.codigoMotivo).toBe(2)
    expect(a.motivo).toBe('Error de firma digital')
    expect(seRecibio(a)).toBe(false)
  })
})

describe('El orden de las comprobaciones importa', () => {
  it('XML invalido gana sobre todo lo demas', () => {
    // Sin poder interpretar el XML no se puede saber el RNC ni si es
    // duplicado: reportar esos motivos seria hablar de datos que no se
    // leyeron.
    const a = decidirAcuse({
      xmlValido: false,
      firmaValida: false,
      duplicado: true,
      rncCompradorCorrecto: false,
    })
    expect(a.codigoMotivo).toBe(1)
  })

  it('firma invalida gana sobre duplicado y RNC', () => {
    const a = decidirAcuse({ ...todoBien, firmaValida: false, duplicado: true, rncCompradorCorrecto: false })
    expect(a.codigoMotivo).toBe(2)
  })

  it('duplicado gana sobre RNC', () => {
    const a = decidirAcuse({ ...todoBien, duplicado: true, rncCompradorCorrecto: false })
    expect(a.codigoMotivo).toBe(3)
  })

  it('el RNC que no corresponde es el ultimo motivo', () => {
    expect(decidirAcuse({ ...todoBien, rncCompradorCorrecto: false }).codigoMotivo).toBe(4)
  })
})

describe('A quien pertenece un e-CF que entra', () => {
  const dest = { tenantId: 't-1', rncTenant: '131223345' }

  it('coincide aunque venga con guiones', () => {
    expect(esParaEsteTenant('131-22334-5', dest)).toBe(true)
  })

  it('un RNC distinto no es para este tenant', () => {
    expect(esParaEsteTenant('130999888', dest)).toBe(false)
  })

  it('un RNC vacio nunca pasa', () => {
    expect(esParaEsteTenant('', dest)).toBe(false)
    expect(esParaEsteTenant('---', dest)).toBe(false)
  })
})

describe('El token de la URL publica', () => {
  const bueno = 'a'.repeat(LARGO_TOKEN_ENDPOINT)

  it('exige al menos 128 bits en hexadecimal', () => {
    expect(LARGO_TOKEN_ENDPOINT).toBe(32)
    expect(tokenValido(bueno)).toBe(true)
  })

  it('rechaza uno corto: es lo unico que separa a un cliente de otro', () => {
    expect(tokenValido('abc123')).toBe(false)
  })

  it('rechaza lo que no es hexadecimal', () => {
    expect(tokenValido('Z'.repeat(32))).toBe(false)
    expect(tokenValido(`${'a'.repeat(31)}-`)).toBe(false)
  })

  it('acepta uno mas largo', () => {
    expect(tokenValido('b'.repeat(64))).toBe(true)
  })
})

describe('Las tres URL que el contribuyente copia al formulario', () => {
  const urls = urlsParaDeclarar('https://erp.regb.do/', 'f'.repeat(32))

  it('salen las tres del mismo sitio, con el token dentro', () => {
    expect(urls.recepcion).toBe(`https://erp.regb.do/api/ecf/${'f'.repeat(32)}/recepcion`)
    expect(urls.aprobacion).toContain('/aprobacion')
    expect(urls.autenticacion).toContain('/autenticacion')
  })

  it('la barra final de la base no duplica la del camino', () => {
    expect(urls.recepcion).not.toContain('//api')
  })

  it('dos tenants nunca comparten URL', () => {
    const otras = urlsParaDeclarar('https://erp.regb.do', 'e'.repeat(32))
    expect(otras.recepcion).not.toBe(urls.recepcion)
  })
})

describe('Lo que se lee de un e-CF entrante', () => {
  const REAL =
    '<ECF><Encabezado><IdDoc><eNCF>E329999999999</eNCF></IdDoc>' +
    '<Emisor><RNCEmisor>130111111</RNCEmisor></Emisor>' +
    '<Comprador><RNCComprador>131223345</RNCComprador></Comprador>' +
    '<Totales><MontoTotal>1180.00</MontoTotal></Totales></Encabezado></ECF>'

  it('saca los campos que hacen falta para acusar', () => {
    const d = leerEcfEntrante(REAL)
    expect(d.encf).toBe('E329999999999')
    expect(d.rncEmisor).toBe('130111111')
    expect(d.rncComprador).toBe('131223345')
    expect(d.montoTotal).toBe(1180)
  })

  it('NO lee dentro de un comentario', () => {
    // Sin esta guarda, un emisor mandaba el e-NCF verdadero dentro de un
    // comentario ANTES del real y el documento se archivaba con el del
    // comentario -sin romper la firma, porque un comentario tambien va
    // firmado-. Mismo efecto que suplantar el comprobante.
    const trampa = '<ECF><!-- <eNCF>E310000000001</eNCF> -->' + REAL.slice(5)
    expect(leerEcfEntrante(trampa).encf).toBe('E329999999999')
  })

  it('tampoco lee el prologo', () => {
    expect(leerEcfEntrante('<?xml version="1.0"?>' + REAL).encf).toBe('E329999999999')
  })

  it('un documento sin los campos devuelve nulos, no basura', () => {
    const d = leerEcfEntrante('<ECF></ECF>')
    expect(d.encf).toBeNull()
    expect(d.rncEmisor).toBeNull()
    expect(d.montoTotal).toBeNull()
  })
})

describe('Un e-CF entrante enorme y mal formado no cuelga el servidor', () => {
  it('un millon de comentarios abiertos se despacha en el acto', () => {
    // `sinComentarios` usaba un patron perezoso hasta el cierre. Sin
    // cierre a la vista, el motor reintenta desde cada apertura: coste
    // cuadratico sobre un cuerpo que llega de fuera topado a 4 MB.
    const basura = '<!--'.repeat(Math.floor((1024 * 1024) / 4))
    const t0 = Date.now()
    const d = leerEcfEntrante(basura)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(d.encf).toBeNull()
  })

  it('un comentario sin cerrar se descarta entero, no se lee lo de dentro', () => {
    // Darlo por contenido bueno dejaria colar un e-NCF escondido.
    expect(leerEcfEntrante('<ECF><!-- <eNCF>E310000000001</eNCF>').encf).toBeNull()
  })
})

