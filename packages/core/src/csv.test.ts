import { describe, expect, it } from 'vitest'
import { mapHeaders, parseCsv, validateProducts } from './csv.js'

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
})
