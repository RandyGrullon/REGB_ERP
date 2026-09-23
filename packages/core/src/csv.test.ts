import { describe, expect, it } from 'vitest'
import {
  detectarDelimitador,
  formatoDelArchivo,
  leerNumero,
  mapHeaders,
  parseCsv,
  parseNumero,
  validateProducts,
} from './csv.js'

describe('parseCsv', () => {
  it('lee filas y columnas basicas', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('respeta comas dentro de comillas', () => {
    expect(parseCsv('sku,nombre\nA1,"Arroz, selecto"')).toEqual([
      ['sku', 'nombre'],
      ['A1', 'Arroz, selecto'],
    ])
  })

  it('entiende comillas escapadas y CRLF de Excel', () => {
    expect(parseCsv('nombre\r\n"Tubo 1"" x 20"')).toEqual([['nombre'], ['Tubo 1" x 20']])
  })

  it('acepta punto y coma, que es lo que exporta Excel en espanol', () => {
    expect(parseCsv('sku;nombre\nA1;Arroz')).toEqual([
      ['sku', 'nombre'],
      ['A1', 'Arroz'],
    ])
  })

  it('descarta lineas totalmente vacias', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('mapHeaders', () => {
  it('reconoce nombres en espanol con y sin acentos', () => {
    const { mapping } = mapHeaders(['Código', 'Descripción', 'Precio'])
    expect(mapping.sku).toBe(0)
    expect(mapping.name).toBe(1)
    expect(mapping.price).toBe(2)
  })

  it('reporta las columnas que no supo mapear', () => {
    const { ignored } = mapHeaders(['sku', 'nombre', 'proveedor favorito'])
    expect(ignored).toEqual(['proveedor favorito'])
  })
})

describe('validateProducts', () => {
  const headers = ['sku', 'nombre', 'precio', 'costo']

  it('acepta filas correctas', () => {
    const r = validateProducts(
      [
        ['A1', 'Arroz 5 lb', '215.00', '178'],
        ['A2', 'Aceite 1 gal', '525', ''],
      ],
      headers,
    )
    expect(r.errors).toEqual([])
    expect(r.valid).toHaveLength(2)
    expect(r.valid[0]!.price).toBe(215)
    expect(r.valid[1]!.cost).toBeNull()
  })

  it('exige las columnas obligatorias antes de mirar las filas', () => {
    const r = validateProducts([['x']], ['precio'])
    expect(r.errors.map((e) => e.column)).toEqual(['sku', 'name'])
    expect(r.valid).toHaveLength(0)
  })

  it('senala la fila exacta que falla y sigue con las demas', () => {
    const r = validateProducts(
      [
        ['A1', 'Bueno', '10', ''],
        ['', 'Sin codigo', '10', ''],
        ['A3', 'Otro bueno', '30', ''],
      ],
      headers,
    )
    expect(r.valid).toHaveLength(2)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.row).toBe(3) // fila 2 de datos = linea 3 del archivo
  })

  it('rechaza codigos repetidos dentro del mismo archivo', () => {
    const r = validateProducts(
      [
        ['A1', 'Uno', '10', ''],
        ['a1', 'Otro con el mismo codigo', '20', ''],
      ],
      headers,
    )
    expect(r.valid).toHaveLength(1)
    expect(r.errors[0]!.message).toContain('se repite')
  })

  it('entiende 1,234.56 y 1.234,56 como el mismo numero', () => {
    const r = validateProducts(
      [
        ['A1', 'Formato ingles', '1,234.56', ''],
        ['A2', 'Formato europeo', '1.234,56', ''],
      ],
      headers,
    )
    expect(r.valid[0]!.price).toBe(1234.56)
    expect(r.valid[1]!.price).toBe(1234.56)
  })

  it('ignora el simbolo de moneda', () => {
    const r = validateProducts([['A1', 'Con peso', 'RD$ 215.00', '']], headers)
    expect(r.valid[0]!.price).toBe(215)
  })

  it('rechaza un precio que no es numero y uno negativo', () => {
    const r = validateProducts(
      [
        ['A1', 'Texto', 'gratis', ''],
        ['A2', 'Negativo', '-5', ''],
      ],
      headers,
    )
    expect(r.valid).toHaveLength(0)
    expect(r.errors).toHaveLength(2)
  })

  it('sin precio asume 0 en vez de fallar', () => {
    const r = validateProducts([['A1', 'Sin precio', '', '']], headers)
    expect(r.valid[0]!.price).toBe(0)
  })

  it('rechaza un costo negativo en la fila, no en la base', () => {
    // Antes pasaba la validacion y el check (cost >= 0) de la base tumbaba
    // la importacion ENTERA con un error de servidor.
    const r = validateProducts(
      [
        ['A1', 'Costo negativo', '100', '-5'],
        ['A2', 'Bueno', '100', '50'],
      ],
      headers,
    )
    expect(r.valid.map((p) => p.sku)).toEqual(['A2'])
    expect(r.errors).toEqual([
      { row: 2, column: 'cost', message: 'El costo no puede ser negativo.' },
    ])
  })

  it('cada fila buena lleva su linea del archivo', () => {
    const r = validateProducts(
      [
        ['', 'Sin codigo', '10', ''],
        ['A2', 'Bueno', '10', ''],
      ],
      headers,
    )
    expect(r.valid[0]!.line).toBe(3)
  })

  it('cuenta filas rechazadas, no mensajes: sin columna obligatoria caen todas', () => {
    const r = validateProducts(
      [['x'], ['y'], ['z']],
      ['precio'], // faltan sku y nombre: dos mensajes, tres filas
    )
    expect(r.errors).toHaveLength(2)
    expect(r.rejectedRows).toBe(3)

    const r2 = validateProducts(
      [
        ['A1', 'Bueno', '10', ''],
        ['', 'Malo', '10', ''],
      ],
      headers,
    )
    expect(r2.rejectedRows).toBe(1)
  })
})

// ── Separador del CSV ────────────────────────────────────────────────────

describe('detectarDelimitador y parseCsv con un solo separador', () => {
  it('toma el separador de la linea de encabezados', () => {
    expect(detectarDelimitador('sku;nombre;precio\nA1;Arroz;1.234,56')).toBe(';')
    expect(detectarDelimitador('sku,nombre,precio\nA1,Arroz,"1,234.56"')).toBe(',')
    expect(detectarDelimitador('"sku;raro",nombre\nA1,Arroz')).toBe(',')
    expect(detectarDelimitador('sku\nA1')).toBe(',')
  })

  it('un CSV de Excel en espanol no parte "1.234,56" en dos columnas', () => {
    // Excel en espanol separa con ";" y NO pone comillas a "1.234,56".
    // Antes el parser cortaba tambien por la coma: precio "1.234", y una
    // columna de mas con "56".
    expect(parseCsv('sku;nombre;precio\nA1;Arroz;1.234,56')).toEqual([
      ['sku', 'nombre', 'precio'],
      ['A1', 'Arroz', '1.234,56'],
    ])
  })

  it('en un CSV con comas, un punto y coma suelto es texto', () => {
    expect(parseCsv('sku,nombre\nA1,Arroz; selecto')).toEqual([
      ['sku', 'nombre'],
      ['A1', 'Arroz; selecto'],
    ])
  })
})

// ── La regla de los numeros ──────────────────────────────────────────────

describe('parseNumero: la regla de los numeros', () => {
  const ok = (valor: number) => ({ ok: true, valor })
  const ambiguo = { ok: false, motivo: 'ambiguo' }
  const invalido = { ok: false, motivo: 'invalido' }

  it.each([
    ['1234', 1234],
    ['1,234', 1234],
    ['1,234.56', 1234.56],
    ['1234.56', 1234.56],
    ['215.00', 215],
    ['1.234,56', 1234.56],
    ['1,234,567.89', 1234567.89],
    ['1.234.567,89', 1234567.89],
    ['1,234,567', 1234567],
    ['1.234.567', 1234567],
    ['12,50', 12.5],
    ['0,500', 0.5],
    ['0.125', 0.125],
    ['1234,567', 1234.567],
    ['.50', 0.5],
  ])('%s -> %d (archivo de RD)', (raw, valor) => {
    expect(parseNumero(raw)).toEqual(ok(valor))
  })

  it.each([
    ['RD$ 1,234.00', 1234],
    ['RD$1,234', 1234],
    ['  RD$  215  ', 215],
    ['RD $ 215', 215],
    ['US$ 10.50', 10.5],
    ['DOP 1,500.00', 1500],
    ['$ 99', 99],
    ['RD$\u00a0215.00', 215], // espacio duro, el que pone Excel
  ])('moneda y espacios: %s -> %d', (raw, valor) => {
    expect(parseNumero(raw)).toEqual(ok(valor))
  })

  it.each([
    ['-1,234.56', -1234.56],
    ['RD$ -500', -500],
    ['-RD$ 500', -500],
    ['- 500', -500],
    ['(1,234.56)', -1234.56],
    ['(RD$ 75.00)', -75],
    ['\u2212500', -500],
  ])('negativos: %s -> %d', (raw, valor) => {
    expect(parseNumero(raw)).toEqual(ok(valor))
  })

  it('cero con signo es cero, no -0', () => {
    expect(parseNumero('-0')).toEqual(ok(0))
  })

  it.each([
    'gratis',
    '12 34',
    '1 234,56',
    '1,23.45',
    '1.234.56',
    '1,234.567,8',
    '0,123.45',
    '1234.',
    '--5',
    '(-5)',
    '5-',
    '10 lb',
    '',
    'RD$',
  ])('%s no es un numero', (raw) => {
    expect(parseNumero(raw)).toEqual(invalido)
  })

  it('1.234 solo es ambiguo: en RD hay quien escribe RD$1.500', () => {
    expect(parseNumero('1.234')).toEqual(ambiguo)
    expect(parseNumero('12.345')).toEqual(ambiguo)
    expect(parseNumero('RD$ 1.500')).toEqual(ambiguo)
  })

  it('en un archivo con coma decimal, 1.234 es mil y 1,234 es ambiguo', () => {
    expect(parseNumero('1.234', 'eu')).toEqual(ok(1234))
    expect(parseNumero('1,234', 'eu')).toEqual(ambiguo)
  })

  it('en un archivo que mezcla los dos formatos, las dos formas son ambiguas', () => {
    expect(parseNumero('1,234', 'mixto')).toEqual(ambiguo)
    expect(parseNumero('1.234', 'mixto')).toEqual(ambiguo)
  })

  it('lo inequivoco se lee igual en cualquier archivo', () => {
    for (const f of ['rd', 'eu', 'mixto'] as const) {
      expect(parseNumero('1.234,56', f)).toEqual(ok(1234.56))
      expect(parseNumero('1,234.56', f)).toEqual(ok(1234.56))
      expect(parseNumero('215.00', f)).toEqual(ok(215))
      expect(parseNumero('12,50', f)).toEqual(ok(12.5))
      expect(parseNumero('1,234,567', f)).toEqual(ok(1234567))
    }
  })
})

describe('leerNumero: que demuestra cada celda', () => {
  it.each([
    ['215.00', 'rd'],
    ['1,234.56', 'rd'],
    ['1,234,567', 'rd'],
    ['12,50', 'eu'],
    ['1.234,56', 'eu'],
    ['1.234.567', 'eu'],
    ['1234', null],
  ])('%s demuestra %s', (raw, demuestra) => {
    const l = leerNumero(raw)
    expect(l.tipo).toBe('numero')
    if (l.tipo === 'numero') expect(l.demuestra).toBe(demuestra)
  })

  it('1,234 no demuestra nada: es la forma ambigua', () => {
    expect(leerNumero('1,234')).toEqual({
      tipo: 'ambiguo',
      separador: ',',
      comoMiles: 1234,
      comoDecimal: 1.234,
    })
  })
})

describe('formatoDelArchivo', () => {
  const celda = (valor: string, linea: number) => ({ valor, linea, columna: 'price' as const })

  it('punto decimal en alguna celda: formato RD', () => {
    const f = formatoDelArchivo([celda('1,234', 2), celda('215.00', 3)], ',')
    expect(f.formato).toBe('rd')
    expect(f.rd).toEqual(celda('215.00', 3))
  })

  it('coma decimal en alguna celda: formato europeo', () => {
    const f = formatoDelArchivo([celda('1,234', 2), celda('12,50', 3)], ',')
    expect(f.formato).toBe('eu')
    expect(f.eu).toEqual(celda('12,50', 3))
  })

  it('las dos cosas: mixto, con un ejemplo de cada una', () => {
    const f = formatoDelArchivo([celda('215.00', 2), celda('12,50', 3), celda('9.99', 4)], ',')
    expect(f.formato).toBe('mixto')
    expect(f.rd).toEqual(celda('215.00', 2))
    expect(f.eu).toEqual(celda('12,50', 3))
  })

  it('sin pruebas en las celdas decide el separador del CSV', () => {
    expect(formatoDelArchivo([celda('1,234', 2), celda('500', 3)], ',')).toEqual({
      formato: 'rd',
      rd: null,
      eu: null,
      porDelimitador: true,
    })
    expect(formatoDelArchivo([celda('1.234', 2)], ';').formato).toBe('eu')
  })
})

describe('validateProducts con numeros ambiguos', () => {
  const headers = ['sku', 'nombre', 'precio', 'costo']

  it('1,234 en un archivo de RD es mil doscientos treinta y cuatro', () => {
    const r = validateProducts(
      [
        ['A1', 'Inversor 1500W', '1,234', '980.50'],
        ['A2', 'Bateria', '2,500', ''],
      ],
      headers,
    )
    expect(r.errors).toEqual([])
    expect(r.valid.map((p) => p.price)).toEqual([1234, 2500])
    expect(r.valid[0]!.cost).toBe(980.5)
    expect(r.numberFormat.formato).toBe('rd')
  })

  it('1,234 donde otras filas usan coma decimal se RECHAZA, con la prueba', () => {
    const r = validateProducts(
      [
        ['A1', 'Ambiguo', '1,234', ''],
        ['A2', 'Con coma decimal', '12,50', ''],
      ],
      headers,
    )
    expect(r.valid.map((p) => [p.sku, p.price])).toEqual([['A2', 12.5]])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.row).toBe(2)
    expect(r.errors[0]!.column).toBe('price')
    expect(r.errors[0]!.message).toContain('"1,234" es ambiguo')
    expect(r.errors[0]!.message).toContain('linea 3: "12,50"')
  })

  it('la coma decimal del COSTO tambien cuenta para el precio', () => {
    const r = validateProducts([['A1', 'Uno', '1,234', '980,50']], headers)
    expect(r.valid).toHaveLength(0)
    expect(r.errors[0]!.column).toBe('price')
    expect(r.errors[0]!.message).toContain('ambiguo')
  })

  it('1.234 solo se rechaza, no se adivina', () => {
    const r = validateProducts([['A1', 'Solo', '1.234', '']], headers)
    expect(r.valid).toHaveLength(0)
    expect(r.errors[0]!.message).toContain('"1.234" es ambiguo')
  })

  it('un archivo que mezcla formatos rechaza lo ambiguo y acepta lo inequivoco', () => {
    const r = validateProducts(
      [
        ['A1', 'Ingles', '1,234.56', ''],
        ['A2', 'Europeo', '1.234,56', ''],
        ['A3', 'Ambiguo', '1,234', ''],
      ],
      headers,
    )
    expect(r.valid.map((p) => p.price)).toEqual([1234.56, 1234.56])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.message).toContain('mezcla')
  })

  it('en un CSV con punto y coma, 1.234 es mil y 1,234 se rechaza', () => {
    const texto = 'codigo;nombre;precio\nA1;Uno;1.234\nA2;Dos;1,234\nA3;Tres;500'
    const filas = parseCsv(texto)
    const r = validateProducts(filas.slice(1), filas[0]!, { delimitador: ';' })
    expect(r.valid.map((p) => [p.sku, p.price])).toEqual([
      ['A1', 1234],
      ['A3', 500],
    ])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.row).toBe(3)
    expect(r.errors[0]!.message).toContain('punto y coma')
  })

  it('un costo ambiguo tambien se rechaza, con su columna', () => {
    const r = validateProducts([['A1', 'Uno', '100', '1.500']], headers)
    expect(r.valid).toHaveLength(0)
    expect(r.errors[0]!.column).toBe('cost')
  })
})
