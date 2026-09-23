import { describe, expect, it } from 'vitest'
import { mapStockHeaders, parseCsv, STOCK_COLUMNS, validateStock } from './csv.js'

/**
 * Existencias iniciales por CSV: codigo, almacen, cantidad y costo.
 *
 * Antes la unica forma de cargar existencias con costo era el "Ajuste
 * manual" de /inventory, pegando el UUID del producto, uno por uno. Esta
 * lectura usa la MISMA regla de numeros que el CSV de productos.
 */

describe('encabezados de existencias', () => {
  it('reconoce codigo, almacen, cantidad y costo en espanol', () => {
    const { mapping, ignored } = mapStockHeaders([
      'Código',
      'Almacén',
      'Cantidad',
      'Costo unitario',
    ])
    expect(mapping).toEqual({ sku: 0, warehouse: 1, qty: 2, unitCost: 3 })
    expect(ignored).toEqual([])
  })

  it('tambien existencia, bodega y costo a secas', () => {
    const { mapping } = mapStockHeaders(['sku', 'bodega', 'existencia', 'costo'])
    expect(mapping).toEqual({ sku: 0, warehouse: 1, qty: 2, unitCost: 3 })
  })

  it('las columnas se publican para la pantalla', () => {
    expect(STOCK_COLUMNS.qty).toContain('cantidad')
    expect(STOCK_COLUMNS.warehouse).toContain('almacen')
  })
})

describe('validateStock', () => {
  const headers = ['codigo', 'almacen', 'cantidad', 'costo']

  it('acepta filas buenas con su linea', () => {
    const r = validateStock(
      [
        ['INV-1', 'Principal', '10', '980.50'],
        ['BAT-1', '', '2.5', ''],
      ],
      headers,
    )
    expect(r.errors).toEqual([])
    expect(r.valid).toEqual([
      { line: 2, sku: 'INV-1', warehouse: 'Principal', qty: 10, unitCost: 980.5 },
      // Sin almacen: el predeterminado. Sin costo: el del catalogo (lo
      // resuelve la accion, que conoce la base).
      { line: 3, sku: 'BAT-1', warehouse: null, qty: 2.5, unitCost: null },
    ])
  })

  it('exige las columnas de codigo y cantidad', () => {
    const r = validateStock([['x', 'y']], ['almacen', 'costo'])
    expect(r.errors.map((e) => e.column)).toEqual(['sku', 'qty'])
    expect(r.rejectedRows).toBe(1)
  })

  it('la cantidad sigue la regla de los numeros: 1,500 en RD es mil quinientos', () => {
    const r = validateStock([['A1', '', '1,500', '215.00']], headers)
    expect(r.valid[0]!.qty).toBe(1500)
    expect(r.valid[0]!.unitCost).toBe(215)
  })

  it('1.500 de cantidad es ambiguo y se rechaza: nunca se adivina', () => {
    const r = validateStock([['A1', '', '1.500', '']], headers)
    expect(r.valid).toHaveLength(0)
    expect(r.errors[0]!.column).toBe('qty')
    expect(r.errors[0]!.message).toContain('"1.500" es ambiguo')
  })

  it('en un Excel en espanol, 1.500 es mil quinientos y 12,50 son doce con cincuenta', () => {
    const texto = 'codigo;almacen;cantidad;costo\nA1;Principal;1.500;12,50'
    const filas = parseCsv(texto)
    const r = validateStock(filas.slice(1), filas[0]!, { delimitador: ';' })
    expect(r.errors).toEqual([])
    expect(r.valid[0]).toMatchObject({ qty: 1500, unitCost: 12.5 })
  })

  it('cantidad cero, negativa o vacia se rechaza: esto carga, no saca', () => {
    const r = validateStock(
      [
        ['A1', '', '0', '10'],
        ['A2', '', '-5', '10'],
        ['A3', '', '', '10'],
        ['A4', '', 'diez', '10'],
      ],
      headers,
    )
    expect(r.valid).toHaveLength(0)
    expect(r.rejectedRows).toBe(4)
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([
      [2, 'qty'],
      [3, 'qty'],
      [4, 'qty'],
      [5, 'qty'],
    ])
    expect(r.errors[0]!.message).toContain('mayor que cero')
  })

  it('costo negativo se rechaza por fila', () => {
    const r = validateStock([['A1', '', '5', '-1']], headers)
    expect(r.errors).toEqual([
      { row: 2, column: 'unitCost', message: 'El costo no puede ser negativo.' },
    ])
  })

  it('el mismo codigo en el mismo almacen dos veces se rechaza; en otro almacen no', () => {
    const r = validateStock(
      [
        ['A1', 'Principal', '5', '10'],
        ['a1', 'principal', '3', '10'],
        ['A1', 'Santiago', '3', '10'],
      ],
      headers,
    )
    expect(r.valid.map((v) => [v.line, v.warehouse])).toEqual([
      [2, 'Principal'],
      [4, 'Santiago'],
    ])
    expect(r.errors[0]!.row).toBe(3)
    expect(r.errors[0]!.message).toContain('se repite')
  })

  it('codigo vacio se rechaza', () => {
    const r = validateStock([['', '', '5', '10']], headers)
    expect(r.errors[0]!.column).toBe('sku')
  })
})
