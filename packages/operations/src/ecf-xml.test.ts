import { describe, expect, it } from 'vitest'
import {
  FORMAS_PAGO_ECF,
  INDICADORES_BIEN_SERVICIO,
  INDICADORES_FACTURACION,
  TIPOS_ECF_XSD,
  TIPOS_INGRESO,
  TIPOS_PAGO,
  escaparXml,
  fechaEcf,
  fechaHoraEcf,
  montoEcf,
  estaFirmado,
  precioEcf,
  telefonoEcf,
  vaPorResumen,
  xmlEcfConsumo,
  type EcfConsumo,
} from './ecf-xml.js'

const BASE: EcfConsumo = {
  encf: 'E320000000001',
  tipoIngresos: '01',
  tipoPago: '1',
  emisor: {
    rnc: '131223345',
    razonSocial: 'Distribuidora Caribe SRL',
    direccion: 'Av. Estrella Sadhala 120, Santiago',
    telefono: '8095550101',
    fechaEmision: new Date('2026-09-11T00:00:00Z'),
  },
  comprador: { rnc: null, razonSocial: null },
  totales: { montoGravadoTotal: 465, totalItbis: 83.7, montoTotal: 548.7 },
  lineas: [
    {
      numeroLinea: 1,
      nombre: 'Cemento gris 42.5 kg',
      indicadorFacturacion: '1',
      bienOServicio: '1',
      cantidad: 1,
      precioUnitario: 465,
      montoItem: 465,
    },
  ],
  fechaHoraFirma: new Date('2026-09-11T09:05:03Z'),
}

describe('Los valores permitidos salen del XSD, no de una guia', () => {
  it('los diez tipos de e-CF estan en el esquema', () => {
    expect([...TIPOS_ECF_XSD]).toEqual(['31', '32', '33', '34', '41', '43', '44', '45', '46', '47'])
  })

  it('tipo de ingresos va de 01 a 06', () => {
    expect(TIPOS_INGRESO).toHaveLength(6)
  })

  it('tipo de pago solo admite tres valores', () => {
    expect([...TIPOS_PAGO]).toEqual(['1', '2', '3'])
  })

  it('hay ocho formas de pago, cinco indicadores de facturacion y dos de bien/servicio', () => {
    expect(FORMAS_PAGO_ECF).toHaveLength(8)
    expect(INDICADORES_FACTURACION).toHaveLength(5)
    expect(INDICADORES_BIEN_SERVICIO).toHaveLength(2)
  })
})

describe('Los formatos que el XSD exige', () => {
  it('la fecha va DD-MM-AAAA, no en ISO', () => {
    expect(fechaEcf(new Date('2026-09-11T00:00:00Z'))).toBe('11-09-2026')
  })

  it('un dia de un digito se rellena con cero', () => {
    expect(fechaEcf(new Date('2026-01-05T00:00:00Z'))).toBe('05-01-2026')
  })

  it('la fecha con hora lleva espacio, no la T de ISO', () => {
    expect(fechaHoraEcf(new Date('2026-09-11T09:05:03Z'))).toBe('11-09-2026 09:05:03')
  })

  it('los montos van con punto y sin separador de miles', () => {
    expect(montoEcf(1234567.5)).toBe('1234567.50')
    expect(montoEcf(548.7)).toBe('548.70')
  })

  it('el precio unitario admite cuatro decimales', () => {
    expect(precioEcf(12.3456)).toBe('12.3456')
    expect(precioEcf(465)).toBe('465')
  })
})

describe('Escapado', () => {
  it('un producto con & no rompe el documento entero', () => {
    expect(escaparXml('Frenos & Clutch')).toBe('Frenos &amp; Clutch')
  })

  it('los cinco caracteres reservados', () => {
    expect(escaparXml(`<a href="x" data='y'>`)).toBe('&lt;a href=&quot;x&quot; data=&apos;y&apos;&gt;')
  })

  it('y llega escapado hasta el XML final', () => {
    const xml = xmlEcfConsumo({
      ...BASE,
      lineas: [{ ...BASE.lineas[0]!, nombre: 'Frenos & Clutch' }],
    })
    expect(xml).toContain('<NombreItem>Frenos &amp; Clutch</NombreItem>')
    expect(xml).not.toContain('Frenos & Clutch')
  })
})

describe('El XML del e-CF 32', () => {
  const xml = xmlEcfConsumo(BASE)

  it('lleva la raiz ECF y la declaracion', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><ECF>')).toBe(true)
    expect(xml.endsWith('</ECF>')).toBe(true)
  })

  it('el tipo va como 32, no como E32', () => {
    expect(xml).toContain('<TipoeCF>32</TipoeCF>')
  })

  it('el e-NCF si va completo, con sus 13 caracteres', () => {
    expect(xml).toContain('<eNCF>E320000000001</eNCF>')
  })

  it('el orden de Encabezado es el del XSD', () => {
    // xs:sequence es ORDENADO: los mismos campos en otro orden no validan.
    const orden = ['<Version>', '<IdDoc>', '<Emisor>', '<Comprador>', '<Totales>']
    const posiciones = orden.map((t) => xml.indexOf(t))
    expect(posiciones.every((p) => p > -1)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
  })

  it('el orden dentro de IdDoc tambien', () => {
    const orden = ['<TipoeCF>', '<eNCF>', '<TipoIngresos>', '<TipoPago>']
    const p = orden.map((t) => xml.indexOf(t))
    expect([...p].sort((a, b) => a - b)).toEqual(p)
  })

  it('el orden dentro de Item tambien', () => {
    const orden = [
      '<NumeroLinea>',
      '<IndicadorFacturacion>',
      '<NombreItem>',
      '<IndicadorBienoServicio>',
      '<CantidadItem>',
      '<PrecioUnitarioItem>',
      '<MontoItem>',
    ]
    const p = orden.map((t) => xml.indexOf(t))
    expect([...p].sort((a, b) => a - b)).toEqual(p)
  })

  it('DetallesItems y FechaHoraFirma van DESPUES del encabezado', () => {
    expect(xml.indexOf('<DetallesItems>')).toBeGreaterThan(xml.indexOf('</Encabezado>'))
    expect(xml.indexOf('<FechaHoraFirma>')).toBeGreaterThan(xml.indexOf('</DetallesItems>'))
  })

  it('Comprador NUNCA sale vacio: un elemento vacio rompe la firma', () => {
    // El XSD lo pide 1..1 pero todos sus hijos son opcionales, asi que en
    // una venta de mostrador quedaria vacio. Y al firmar, un elemento
    // vacio hace que el digest se calcule sobre `<a/>` mientras quien
    // verifica canonicaliza `<a></a>`: la firma no valida. Ver
    // `elementosVacios()` en @regb/ecf-firma.
    expect(xml).not.toContain('<Comprador></Comprador>')
    expect(xml).toContain('<Comprador><RazonSocialComprador>CONSUMIDOR FINAL</RazonSocialComprador></Comprador>')
  })

  it('con comprador identificado sale su razon social, no el generico', () => {
    const conCliente = xmlEcfConsumo({
      ...BASE,
      comprador: { rnc: '130111111', razonSocial: 'Ferreteria El Martillo SRL' },
    })
    expect(conCliente).toContain('<RNCComprador>130111111</RNCComprador>')
    expect(conCliente).toContain('<RazonSocialComprador>Ferreteria El Martillo SRL</RazonSocialComprador>')
  })

  it('un campo opcional sin valor NO se emite vacio', () => {
    const sinTelefono = xmlEcfConsumo({
      ...BASE,
      emisor: { ...BASE.emisor, telefono: undefined },
      totales: { montoTotal: 100 },
    })
    expect(sinTelefono).not.toContain('TablaTelefonoEmisor')
    expect(sinTelefono).not.toContain('<TotalITBIS>')
    expect(sinTelefono).toContain('<MontoTotal>100.00</MontoTotal>')
  })
})

describe('Lo que se rechaza antes de armar un XML malo', () => {
  it('un e-NCF de 11 caracteres no pasa', () => {
    expect(() => xmlEcfConsumo({ ...BASE, encf: 'E3200000001' })).toThrow(/13 caracteres/)
  })

  it('un e-CF sin lineas no pasa', () => {
    expect(() => xmlEcfConsumo({ ...BASE, lineas: [] })).toThrow(/al menos un Item/)
  })

  it('un RNC con guiones no pasa: el esquema pide solo digitos', () => {
    expect(() => xmlEcfConsumo({ ...BASE, emisor: { ...BASE.emisor, rnc: '131-22334-5' } })).toThrow(
      /9 u 11 digitos/,
    )
  })
})

describe('Por donde viaja', () => {
  it('una factura de consumo chica va por resumen', () => {
    expect(vaPorResumen(548.7)).toBe(true)
  })

  it('una grande va completa', () => {
    expect(vaPorResumen(250_000)).toBe(false)
  })
})

// ── Lo que encontro validar contra el XSD oficial ────────────────────────

describe('El telefono, que el validador destapo', () => {
  it('el esquema pide guiones: se los pone', () => {
    expect(telefonoEcf('8095550101')).toBe('809-555-0101')
    expect(telefonoEcf('809-555-0101')).toBe('809-555-0101')
    expect(telefonoEcf('(809) 555 0101')).toBe('809-555-0101')
  })

  it('lo que no cabe en el formato devuelve null, no basura', () => {
    expect(telefonoEcf('555')).toBeNull()
    expect(telefonoEcf('18095550101')).toBeNull()
  })

  it('en el XML sale con guiones aunque entre corrido', () => {
    expect(xmlEcfConsumo(BASE)).toContain('<TelefonoEmisor>809-555-0101</TelefonoEmisor>')
  })

  it('un telefono impresentable se OMITE en vez de invalidar el documento', () => {
    const xml = xmlEcfConsumo({ ...BASE, emisor: { ...BASE.emisor, telefono: '555' } })
    expect(xml).not.toContain('TablaTelefonoEmisor')
  })
})

describe('La firma es un hijo OBLIGATORIO, no un paso posterior', () => {
  it('sin firma el documento no esta listo', () => {
    // El XSD pide <xs:any minOccurs="1"> despues de FechaHoraFirma: un
    // e-CF sin firmar NO valida, por perfecto que este el resto.
    expect(estaFirmado(xmlEcfConsumo(BASE))).toBe(false)
  })

  it('con firma, va dentro del documento y despues de FechaHoraFirma', () => {
    const firma = '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>abc</ds:SignatureValue></ds:Signature>'
    const xml = xmlEcfConsumo({ ...BASE, firma })
    expect(estaFirmado(xml)).toBe(true)
    expect(xml.indexOf('<ds:Signature')).toBeGreaterThan(xml.indexOf('<FechaHoraFirma>'))
    expect(xml.endsWith('</ECF>')).toBe(true)
  })

  it('reconoce la firma con o sin prefijo de espacio de nombres', () => {
    expect(estaFirmado('<ECF><Signature></Signature></ECF>')).toBe(true)
    expect(estaFirmado('<ECF><ds:Signature /></ECF>')).toBe(true)
    expect(estaFirmado('<ECF><SignatureValue>x</SignatureValue></ECF>')).toBe(false)
  })
})
