import { describe, expect, it } from 'vitest'
import {
  leerCodigoDeBarras,
  leerExento,
  leerTasaItbis,
  mapHeaders,
  PRODUCT_COLUMNS,
  validateProducts,
} from './csv.js'

/**
 * Codigo de barras y ITBIS en el CSV de productos.
 *
 * PRIMER-CLIENTE.md y HARDWARE-Y-DGII.md prometian que el CSV traia el
 * codigo de barras, y no lo traia: el lector no servia hasta editar cada
 * producto a mano, y cada exento (arroz, habichuela, platano) igual.
 */

describe('encabezados nuevos', () => {
  it('reconoce codigo de barras y no lo confunde con el codigo (sku)', () => {
    const { mapping, ignored } = mapHeaders([
      'Código',
      'Descripción',
      'Código de barras',
      'Tasa ITBIS',
      'Exento',
    ])
    expect(mapping.sku).toBe(0)
    expect(mapping.name).toBe(1)
    expect(mapping.barcode).toBe(2)
    expect(mapping.taxRate).toBe(3)
    expect(mapping.exempt).toBe(4)
    expect(ignored).toEqual([])
  })

  it('acepta los nombres cortos que usa la gente: ean, itbis, exenta', () => {
    const { mapping } = mapHeaders(['sku', 'nombre', 'EAN', 'ITBIS', 'exenta'])
    expect(mapping.barcode).toBe(2)
    expect(mapping.taxRate).toBe(3)
    expect(mapping.exempt).toBe(4)
  })

  it('la lista de columnas que ve la pantalla incluye las tres', () => {
    expect(PRODUCT_COLUMNS.barcode).toContain('codigo de barras')
    expect(PRODUCT_COLUMNS.taxRate).toContain('itbis')
    expect(PRODUCT_COLUMNS.exempt).toContain('exento')
  })
})

describe('leerTasaItbis', () => {
  it.each([
    ['0.18', 0.18],
    ['0,18', 0.18],
    ['18', 0.18],
    ['18%', 0.18],
    ['18 %', 0.18],
    ['0.16', 0.16],
    ['16%', 0.16],
    ['0', 0],
    ['0%', 0],
    ['exento', 0],
    ['Exenta', 0],
    ['EXENTO', 0],
  ])('"%s" es %s', (raw, tasa) => {
    expect(leerTasaItbis(raw)).toEqual({ ok: true, tasa })
  })

  it('vacia no decide nada: la tasa sale del cliente', () => {
    expect(leerTasaItbis('')).toBeNull()
    expect(leerTasaItbis('   ')).toBeNull()
  })

  it.each(['0.12', '12%', '1', '100%', 'dieciocho', '18.5', '-18', '0.180.0'])(
    '"%s" no es una tasa de ITBIS valida',
    (raw) => {
      const r = leerTasaItbis(raw)
      expect(r).not.toBeNull()
      expect(r!.ok).toBe(false)
    },
  )
})

describe('leerExento', () => {
  it.each(['si', 'sí', 'Si', 'S', 'x', 'X', 'yes', '1', 'true', 'exento'])(
    '"%s" es exento',
    (raw) => {
      expect(leerExento(raw)).toEqual({ ok: true, exento: true })
    },
  )
  it.each(['no', 'No', 'N', '0', 'false'])('"%s" no es exento', (raw) => {
    expect(leerExento(raw)).toEqual({ ok: true, exento: false })
  })
  it('vacio no dice nada', () => {
    expect(leerExento('')).toBeNull()
  })
  it('lo que no se entiende se rechaza', () => {
    expect(leerExento('tal vez')!.ok).toBe(false)
  })
})

describe('leerCodigoDeBarras', () => {
  it('guarda el codigo tal cual, sin espacios de los bordes', () => {
    expect(leerCodigoDeBarras(' 7460000000017 ')).toEqual({ ok: true, codigo: '7460000000017' })
    expect(leerCodigoDeBarras('0012345678905')).toEqual({ ok: true, codigo: '0012345678905' })
    expect(leerCodigoDeBarras('INT-0042')).toEqual({ ok: true, codigo: 'INT-0042' })
  })

  it('vacio es "sin codigo"', () => {
    expect(leerCodigoDeBarras('')).toEqual({ ok: true, codigo: null })
  })

  it('la notacion cientifica de Excel se rechaza con el remedio', () => {
    const r = leerCodigoDeBarras('7.46E+12')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('Texto')
  })

  it('espacios en medio o simbolos se rechazan', () => {
    expect(leerCodigoDeBarras('746 000 017').ok).toBe(false)
    expect(leerCodigoDeBarras('74#60').ok).toBe(false)
  })
})

describe('validateProducts con codigo de barras e ITBIS', () => {
  const headers = ['sku', 'nombre', 'precio', 'codigo de barras', 'itbis', 'exento']

  it('lleva el codigo de barras y la tasa de cada fila', () => {
    const r = validateProducts(
      [
        ['ARZ-5', 'Arroz selecto 5 lb', '215.00', '7460000000017', '', 'si'],
        ['ACE-1', 'Aceite 1 gal', '525.00', '7460000000024', '18%', ''],
        ['YOG-1', 'Yogurt', '65.00', '', '16%', 'no'],
        ['PAN-1', 'Pan sobao', '10.00', '', '', ''],
      ],
      headers,
    )
    expect(r.errors).toEqual([])
    expect(r.valid.map((p) => [p.sku, p.barcode, p.taxRate])).toEqual([
      ['ARZ-5', '7460000000017', 0],
      ['ACE-1', '7460000000024', 0.18],
      ['YOG-1', null, 0.16],
      // Sin tasa ni exento: null, y la base pone la tasa por defecto del cliente.
      ['PAN-1', null, null],
    ])
  })

  it('una tasa invalida rechaza la fila con su motivo y su columna', () => {
    const r = validateProducts([['A1', 'Uno', '10', '', '12%', '']], headers)
    expect(r.valid).toHaveLength(0)
    expect(r.rejectedRows).toBe(1)
    expect(r.errors[0]!.column).toBe('taxRate')
    expect(r.errors[0]!.message).toContain('"12%"')
    expect(r.errors[0]!.message).toContain('exento')
  })

  it('exento y una tasa positiva a la vez es una contradiccion, no se adivina', () => {
    const r = validateProducts([['A1', 'Uno', '10', '', '18%', 'si']], headers)
    expect(r.valid).toHaveLength(0)
    expect(r.errors[0]!.column).toBe('exempt')
  })

  it('"no exento" con tasa 0 tambien se contradice', () => {
    const r = validateProducts([['A1', 'Uno', '10', '', '0', 'no']], headers)
    expect(r.valid).toHaveLength(0)
    expect(r.errors[0]!.column).toBe('exempt')
  })

  it('un codigo de barras repetido en el archivo se rechaza en la segunda fila', () => {
    const r = validateProducts(
      [
        ['A1', 'Uno', '10', '7460000000017', '', ''],
        ['A2', 'Dos', '10', '7460000000017', '', ''],
      ],
      headers,
    )
    expect(r.valid.map((p) => p.sku)).toEqual(['A1'])
    expect(r.errors).toEqual([
      {
        row: 3,
        column: 'barcode',
        message: 'El codigo de barras "7460000000017" se repite (ya esta en la linea 2).',
      },
    ])
  })

  it('la columna de ITBIS no decide el formato de los numeros del archivo', () => {
    // "0,18" prueba coma decimal, pero es una tasa: si contara, el "1,234"
    // del precio pasaria a ser ambiguo en un archivo de RD.
    const r = validateProducts([['A1', 'Uno', '1,234', '', '0,18', '']], headers)
    expect(r.errors).toEqual([])
    expect(r.valid[0]!.price).toBe(1234)
    expect(r.valid[0]!.taxRate).toBe(0.18)
  })

  it('un archivo sin estas columnas sigue igual: sin codigo y tasa del cliente', () => {
    const r = validateProducts([['A1', 'Uno', '10', '']], ['sku', 'nombre', 'precio', 'costo'])
    expect(r.valid[0]!.barcode).toBeNull()
    expect(r.valid[0]!.taxRate).toBeNull()
  })
})
