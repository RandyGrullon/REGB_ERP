import { describe, expect, it } from 'vitest'
import {
  CAMPOS_606,
  CAMPOS_607,
  CAMPOS_608,
  TIPOS_ANULACION,
  FORMAS_PAGO_606,
  TIPOS_GASTO_606,
  esFormaPago606,
  esTipoGasto606,
  generar606,
  generar607,
  generar608,
  nombreArchivo,
} from './dgii-envio'

/**
 * Lo que se prueba aqui es lo que hace rebotar una declaracion.
 *
 * Un archivo de envio no falla a medias: o la DGII lo acepta entero o lo
 * rechaza entero. Un campo de menos en una linea corre TODAS las demas de
 * posicion, y el contribuyente se entera el dia 20.
 */

const VENTA = {
  rncComprador: '130111111',
  tipoIdentificacion: '1' as const,
  ncf: 'B0100000501',
  fechaComprobante: '20260803',
  montoFacturado: 100,
  itbisFacturado: 18,
  efectivo: 118,
}

describe('Estructura del archivo', () => {
  it('la cabecera lleva codigo, RNC del emisor, periodo y conteo', () => {
    const txt = generar607('130111111', '202608', [VENTA])
    expect(txt.split('\r\n')[0]).toBe('607|130111111|202608|1')
  })

  it('el conteo NO incluye la linea de cabecera', () => {
    const txt = generar607('130111111', '202608', [VENTA, VENTA, VENTA])
    const [cabecera, ...resto] = txt.trimEnd().split('\r\n')
    expect(cabecera!.split('|')[3]).toBe('3')
    expect(resto).toHaveLength(3)
  })

  it('cada linea de detalle lleva exactamente 23 campos', () => {
    const txt = generar607('130111111', '202608', [VENTA])
    const detalle = txt.trimEnd().split('\r\n')[1]!
    expect(detalle.split('|')).toHaveLength(CAMPOS_607)
  })

  it('el 608 lleva 3 campos por linea', () => {
    const txt = generar608('130111111', '202608', [
      { ncf: 'B0200000001', fechaComprobante: '20260803', tipoAnulacion: '4' },
    ])
    expect(txt.trimEnd().split('\r\n')[1]!.split('|')).toHaveLength(CAMPOS_608)
  })

  it('separa con pipe y termina las lineas con CRLF', () => {
    const txt = generar607('130111111', '202608', [VENTA])
    expect(txt).toContain('|')
    expect(txt.endsWith('\r\n')).toBe(true)
    expect(txt).not.toContain('\n\n')
  })

  it('no anade un separador de mas al final', () => {
    // Ojo con el matiz: la linea SI puede acabar en "|" porque el campo 23
    // (otras formas de venta) suele ir vacio, y un campo vacio al final es
    // legitimo. Lo que no puede haber es un separador de MAS: 23 campos
    // son exactamente 22 pipes. Contar los separadores es la unica forma
    // de distinguir las dos cosas.
    const detalle = generar607('130111111', '202608', [VENTA]).trimEnd().split('\r\n')[1]!
    expect(detalle.split('|').length - 1).toBe(CAMPOS_607 - 1)
  })

  it('un archivo sin ventas sigue siendo valido: cabecera con cero', () => {
    const txt = generar607('130111111', '202608', [])
    expect(txt.trimEnd()).toBe('607|130111111|202608|0')
  })
})

describe('Los campos van en su posicion', () => {
  it('el RNC del comprador va primero y el tipo despues', () => {
    const c = generar607('130111111', '202608', [VENTA]).trimEnd().split('\r\n')[1]!.split('|')
    expect(c[0]).toBe('130111111')
    expect(c[1]).toBe('1')
    expect(c[2]).toBe('B0100000501')
  })

  it('la fecha va en la posicion 6, no en la 4', () => {
    const c = generar607('130111111', '202608', [VENTA]).trimEnd().split('\r\n')[1]!.split('|')
    expect(c[5]).toBe('20260803')
    expect(c[3]).toBe('') // NCF modificado: vacio si no es nota de credito
  })

  it('monto e ITBIS van separados y con dos decimales', () => {
    const c = generar607('130111111', '202608', [VENTA]).trimEnd().split('\r\n')[1]!.split('|')
    expect(c[7]).toBe('100.00')
    expect(c[8]).toBe('18.00')
  })

  it('las formas de pago van del 17 al 23', () => {
    const c = generar607('130111111', '202608', [{ ...VENTA, efectivo: 50, tarjeta: 68 }])
      .trimEnd()
      .split('\r\n')[1]!
      .split('|')
    expect(c[16]).toBe('50.00') // efectivo
    expect(c[17]).toBe('') //      cheque/transferencia
    expect(c[18]).toBe('68.00') // tarjeta
  })

  it('un consumidor final va sin RNC y con tipo 3', () => {
    const c = generar607('130111111', '202608', [
      { ...VENTA, rncComprador: null, tipoIdentificacion: '3' },
    ])
      .trimEnd()
      .split('\r\n')[1]!
      .split('|')
    expect(c[0]).toBe('')
    expect(c[1]).toBe('3')
    // Y la linea NO pierde campos por eso: el formato es posicional.
    expect(c).toHaveLength(CAMPOS_607)
  })

  it('los campos vacios quedan entre dos pipes, sin colapsar', () => {
    const detalle = generar607('130111111', '202608', [
      { ...VENTA, itbisFacturado: 0, efectivo: 0 },
    ])
      .trimEnd()
      .split('\r\n')[1]!
    expect(detalle).toContain('||')
    expect(detalle.split('|')).toHaveLength(CAMPOS_607)
  })
})

describe('Lo que se rechaza antes de generar un archivo malo', () => {
  it('un RNC de emisor con guiones', () => {
    expect(() => generar607('130-11111-1', '202608', [VENTA])).toThrow(/sin guiones/)
  })

  it('un RNC de emisor con largo raro', () => {
    expect(() => generar607('1234', '202608', [VENTA])).toThrow(/9 digitos/)
  })

  it('un periodo que no es AAAAMM', () => {
    expect(() => generar607('130111111', 'agosto', [VENTA])).toThrow(/AAAAMM/)
  })

  it('un mes 13', () => {
    expect(() => generar607('130111111', '202613', [VENTA])).toThrow(/no existe/)
  })

  it('un pipe dentro de un valor, que correria todos los campos', () => {
    expect(() => generar607('130111111', '202608', [{ ...VENTA, ncf: 'B01|0000501' }])).toThrow(
      /separador/,
    )
  })

  it('el 608 exige el CODIGO de anulacion, no un texto', () => {
    // Es la trampa del 608: guardamos el motivo en palabras y la DGII
    // pide un numero del 1 al 8. Un texto no se puede declarar.
    expect(() =>
      generar608('130111111', '202608', [
        {
          ncf: 'B0200000001',
          fechaComprobante: '20260803',
          tipoAnulacion: 'devolucion del cliente',
        },
      ]),
    ).toThrow(/codigo del 1 al 8/)
  })

  it('acepta los ocho codigos que enumera el instructivo', () => {
    for (const codigo of Object.keys(TIPOS_ANULACION)) {
      expect(() =>
        generar608('130111111', '202608', [
          { ncf: 'B0200000001', fechaComprobante: '20260803', tipoAnulacion: codigo },
        ]),
      ).not.toThrow()
    }
  })
})

describe('Nombre del archivo', () => {
  it('replica la convencion de la herramienta de la DGII', () => {
    expect(nombreArchivo('607', '130111111', '202608')).toBe('DGII_F_607_130111111_202608.TXT')
    expect(nombreArchivo('608', '130111111', '202608')).toBe('DGII_F_608_130111111_202608.TXT')
  })
})

describe('Una cifra grande no se rompe', () => {
  it('un monto de siete cifras conserva sus decimales', () => {
    const c = generar607('130111111', '202608', [
      { ...VENTA, montoFacturado: 1234567.89, itbisFacturado: 222222.22 },
    ])
      .trimEnd()
      .split('\r\n')[1]!
      .split('|')
    // Sin separador de miles: la norma no lo admite y meteria una coma
    // que la DGII leeria como otro campo en un CSV, o como basura aqui.
    expect(c[7]).toBe('1234567.89')
    expect(c[8]).toBe('222222.22')
  })
})

// ── 606 ──────────────────────────────────────────────────────────────────

const COMPRA = {
  rncProveedor: '130222222',
  tipoIdentificacion: '1' as const,
  tipoGasto: '09',
  ncf: 'B0100000777',
  fechaComprobante: '20260803',
  fechaPago: '20260815',
  montoBienes: 1000,
  montoFacturado: 1000,
  itbisFacturado: 180,
  formaPago: '02',
}

describe('606 — estructura', () => {
  it('la cabecera lleva 606, RNC del emisor, periodo y conteo', () => {
    const txt = generar606('130111111', '202608', [COMPRA])
    expect(txt.split('\r\n')[0]).toBe('606|130111111|202608|1')
  })

  it('el detalle lleva exactamente 23 campos', () => {
    const txt = generar606('130111111', '202608', [COMPRA])
    const detalle = txt.trimEnd().split('\r\n')[1]!
    expect(detalle.split('|')).toHaveLength(CAMPOS_606)
  })

  it('un 606 sin compras sigue siendo un archivo valido', () => {
    const txt = generar606('130111111', '202608', [])
    expect(txt).toBe('606|130111111|202608|0\r\n')
  })
})

describe('606 — los campos van en su posicion', () => {
  const campos = generar606('130111111', '202608', [COMPRA]).trimEnd().split('\r\n')[1]!.split('|')

  it('el tipo de gasto es el campo 3', () => {
    expect(campos[2]).toBe('09')
  })

  it('la fecha de pago es el campo 7', () => {
    expect(campos[6]).toBe('20260815')
  })

  it('bienes va en el 9 y el total facturado en el 10', () => {
    expect(campos[7]).toBe('') // servicios: vacio, no cero
    expect(campos[8]).toBe('1000.00')
    expect(campos[9]).toBe('1000.00')
  })

  it('la forma de pago es el ultimo campo', () => {
    expect(campos[22]).toBe('02')
  })
})

describe('606 — lo que se rechaza antes de generar un archivo malo', () => {
  it('una clasificacion de gasto inventada no pasa', () => {
    expect(() => generar606('130111111', '202608', [{ ...COMPRA, tipoGasto: '99' }])).toThrow(
      /clasificacion de gasto valida/,
    )
  })

  it('un gasto escrito a mano en vez del codigo no pasa', () => {
    expect(() =>
      generar606('130111111', '202608', [{ ...COMPRA, tipoGasto: 'Compra de mercancia' }]),
    ).toThrow(/del 01 al 11/)
  })

  it('una forma de pago fuera del catalogo no pasa', () => {
    expect(() => generar606('130111111', '202608', [{ ...COMPRA, formaPago: '09' }])).toThrow(
      /forma de pago valida/,
    )
  })

  it('retencion de ISR sin fecha de pago no pasa', () => {
    expect(() =>
      generar606('130111111', '202608', [
        { ...COMPRA, fechaPago: null, tipoRetencionIsr: '02', retencionRenta: 100 },
      ]),
    ).toThrow(/no tiene fecha de pago/)
  })

  it('un tipo de retencion de ISR desconocido no pasa', () => {
    expect(() =>
      generar606('130111111', '202608', [{ ...COMPRA, tipoRetencionIsr: '77' }]),
    ).toThrow(/retencion de ISR que la DGII no reconoce/)
  })

  it('el RNC del emisor sigue siendo el del que compra, y se valida', () => {
    expect(() => generar606('123', '202608', [COMPRA])).toThrow(/RNC del emisor/)
  })
})

describe('606 — catalogos de codigos', () => {
  it('los once tipos de gasto estan completos', () => {
    expect(Object.keys(TIPOS_GASTO_606)).toHaveLength(11)
    expect(esTipoGasto606('01')).toBe(true)
    expect(esTipoGasto606('11')).toBe(true)
    expect(esTipoGasto606('12')).toBe(false)
  })

  it('las siete formas de pago estan completas', () => {
    expect(Object.keys(FORMAS_PAGO_606)).toHaveLength(7)
    expect(esFormaPago606('07')).toBe(true)
    expect(esFormaPago606('0')).toBe(false)
  })

  it('el nombre del archivo sigue el patron de la DGII', () => {
    expect(nombreArchivo('606', '130111111', '202608')).toBe('DGII_F_606_130111111_202608.TXT')
  })
})
