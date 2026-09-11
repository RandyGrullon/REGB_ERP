import { describe, expect, it } from 'vitest'
import {
  DIAS_MAX_SIN_SISTEMA,
  ESTADO_ECF,
  TIPOS_ECF,
  UMBRAL_RFCE,
  codigoSeguridad,
  comprobanteEnContingencia,
  esEcf,
  esValidoFiscalmente,
  excedioContingencia,
  horasRestantesParaRemitir,
  nombreArchivoEcf,
  puedeReutilizarSecuencia,
  requiereRevision,
  rutaDeEnvio,
  sigueEnProceso,
  urlTimbre,
  urlTimbreResumen,
  venciPlazoDeRemision,
} from './ecf.js'
import { formatNcf, isValidNcf, NCF_LABELS, requiresBuyerTaxId } from './dgii.js'

describe('Los diez tipos de e-CF', () => {
  it('son exactamente diez y ninguno mas', () => {
    expect(TIPOS_ECF).toHaveLength(10)
    expect([...TIPOS_ECF]).toEqual(['E31', 'E32', 'E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47'])
  })

  it('todos tienen etiqueta legible', () => {
    for (const t of TIPOS_ECF) expect(NCF_LABELS[t]).toBeTruthy()
  })

  it('un NCF de papel no es un e-CF', () => {
    expect(esEcf('B02')).toBe(false)
    expect(esEcf('E32')).toBe(true)
  })

  it('el e-NCF son 13 caracteres: E + tipo + 10 de secuencia', () => {
    const encf = formatNcf('E31', 1)
    expect(encf).toBe('E310000000001')
    expect(encf).toHaveLength(13)
    expect(isValidNcf(encf)).toBe(true)
  })

  it('los seis tipos nuevos tambien validan', () => {
    for (const t of ['E41', 'E43', 'E44', 'E45', 'E46', 'E47'] as const) {
      expect(isValidNcf(formatNcf(t, 7))).toBe(true)
    }
  })

  it('regimenes especiales y gubernamental exigen RNC del comprador', () => {
    expect(requiresBuyerTaxId('E44')).toBe(true)
    expect(requiresBuyerTaxId('E45')).toBe(true)
    // Consumo no: el comprador puede ser un consumidor final sin RNC.
    expect(requiresBuyerTaxId('E32')).toBe(false)
  })
})

describe('El corte de RD$250,000 parte la arquitectura en dos', () => {
  it('una factura de consumo chica va por resumen -el caso normal de una PYME-', () => {
    expect(rutaDeEnvio('E32', 4_500)).toBe('rfce-resumen')
  })

  it('justo por debajo del umbral sigue siendo resumen', () => {
    expect(rutaDeEnvio('E32', UMBRAL_RFCE - 0.01)).toBe('rfce-resumen')
  })

  it('exactamente en el umbral ya va completo', () => {
    expect(rutaDeEnvio('E32', UMBRAL_RFCE)).toBe('ecf-completo')
  })

  it('un credito fiscal va completo aunque sea de RD$500', () => {
    // El comprador necesita el detalle para descontarse el ITBIS.
    expect(rutaDeEnvio('E31', 500)).toBe('ecf-completo')
  })

  it('el corte NO aplica a los demas tipos', () => {
    for (const t of ['E33', 'E34', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47'] as const) {
      expect(rutaDeEnvio(t, 100)).toBe('ecf-completo')
    }
  })
})

describe('Los cinco estados, con sus dos trampas', () => {
  it('los cinco tienen nombre', () => {
    expect(Object.keys(ESTADO_ECF)).toHaveLength(5)
  })

  it('aceptado condicional SI vale fiscalmente', () => {
    expect(esValidoFiscalmente(4)).toBe(true)
    expect(esValidoFiscalmente(1)).toBe(true)
  })

  it('pero aceptado condicional pide que alguien lo mire', () => {
    expect(requiereRevision(4)).toBe(true)
    expect(requiereRevision(1)).toBe(false)
  })

  it('rechazado no vale', () => {
    expect(esValidoFiscalmente(2)).toBe(false)
  })

  it('en proceso y no encontrado piden volver a consultar', () => {
    expect(sigueEnProceso(3)).toBe(true)
    expect(sigueEnProceso(0)).toBe(true)
    expect(sigueEnProceso(1)).toBe(false)
  })

  it('secuenciaUtilizada tiene la polaridad al reves', () => {
    // true = ya se quemo, NO se puede reutilizar.
    expect(puedeReutilizarSecuencia(true)).toBe(false)
    expect(puedeReutilizarSecuencia(false)).toBe(true)
  })
})

describe('Codigo de seguridad y timbre', () => {
  const firma = 'dcp79qA1B2C3D4E5F6G7H8I9J0=='

  it('son los primeros seis caracteres de la firma', () => {
    expect(codigoSeguridad(firma)).toBe('dcp79q')
  })

  it('ignora los saltos de linea que traen las firmas en base64', () => {
    expect(codigoSeguridad('dcp\n79q\nAAAA')).toBe('dcp79q')
  })

  it('una firma demasiado corta se rechaza en vez de devolver basura', () => {
    expect(() => codigoSeguridad('abc')).toThrow(/demasiado corto/)
  })

  it('la URL del timbre lleva los siete campos', () => {
    const url = urlTimbre(
      {
        rncEmisor: '130000001',
        rncComprador: '130000002',
        encf: 'E310000000001',
        fechaEmision: '10-10-2026',
        montoTotal: 2.11,
        fechaFirma: '10-10-2026 09:00:00',
        codigoSeguridad: 'dcp79q',
      },
      'testecf',
    )
    expect(url).toContain('/testecf/consultatimbre?')
    expect(url).toContain('rncemisor=130000001')
    expect(url).toContain('encf=E310000000001')
    expect(url).toContain('montototal=2.11')
    // El espacio de la fecha de firma va escapado, como manda la norma.
    expect(url).toContain('fechafirma=10-10-2026+09%3A00%3A00')
  })

  it('el timbre del resumen va a OTRO dominio y con menos campos', () => {
    const url = urlTimbreResumen(
      { rncEmisor: '130000001', encf: 'E320000000009', montoTotal: 4500, codigoSeguridad: 'abc123' },
      'testecf',
    )
    expect(url).toContain('https://fc.dgii.gov.do/testecf/consultatimbrefc?')
    expect(url).not.toContain('rnccomprador')
    expect(url).not.toContain('fechafirma')
  })

  it('el nombre del archivo es el RNC pegado al e-NCF', () => {
    expect(nombreArchivoEcf('101-67291-9', 'E310000000001')).toBe('101672919E310000000001.xml')
  })
})

describe('Contingencia', () => {
  const emitido = new Date('2026-09-11T08:00:00Z')

  it('sin conexion se sigue emitiendo e-CF', () => {
    expect(comprobanteEnContingencia('sin-conexion')).toBe('e-CF')
  })

  it('sin sistema se vuelve al papel de la serie B, que el ERP ya emite', () => {
    expect(comprobanteEnContingencia('sin-sistema')).toBe('serie-B')
  })

  it('quedan 72 horas al emitir y menos despues', () => {
    expect(horasRestantesParaRemitir(emitido, emitido)).toBe(72)
    expect(horasRestantesParaRemitir(emitido, new Date('2026-09-12T08:00:00Z'))).toBe(48)
  })

  it('el plazo se vence pasadas las 72 horas', () => {
    expect(venciPlazoDeRemision(emitido, new Date('2026-09-14T07:00:00Z'))).toBe(false)
    expect(venciPlazoDeRemision(emitido, new Date('2026-09-14T09:00:00Z'))).toBe(true)
  })

  it('la contingencia sin sistema tiene un maximo legal de 15 dias', () => {
    const inicio = new Date('2026-09-01T00:00:00Z')
    expect(DIAS_MAX_SIN_SISTEMA).toBe(15)
    expect(excedioContingencia(inicio, new Date('2026-09-15T00:00:00Z'))).toBe(false)
    expect(excedioContingencia(inicio, new Date('2026-09-17T00:00:00Z'))).toBe(true)
  })
})
