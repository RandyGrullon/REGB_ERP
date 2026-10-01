import { describe, expect, it } from 'vitest'
import { cantidad, cantidadConSigno, pesos, unidadEnPlural, unirFrases } from './cantidad'

describe('cantidad', () => {
  it('quita los ceros que postgres deja en numeric(14,3)', () => {
    expect(cantidad('15.000')).toBe('15')
    expect(cantidad('2.500')).toBe('2.5')
    expect(cantidad('1200.000')).toBe('1,200')
  })

  it('pone la unidad del catálogo en plural cuando no es una', () => {
    expect(cantidad('15.000', 'saco')).toBe('15 sacos')
    expect(cantidad('1.000', 'saco')).toBe('1 saco')
    expect(cantidad('4.5', 'galón')).toBe('4.5 galones')
    expect(cantidad(20, 'unidad')).toBe('20 unidades')
    expect(cantidad(3, 'm³')).toBe('3 m³')
  })

  it('sin valor muestra una raya, no "NaN"', () => {
    expect(cantidad(null)).toBe('—')
    expect(cantidad('abc')).toBe('—')
  })
})

describe('unidadEnPlural', () => {
  it.each([
    ['cartón', 'cartones'],
    ['cubeta', 'cubetas'],
    ['libra', 'libras'],
    ['kit', 'kits'],
    ['par', 'pares'],
    ['caja de 12', 'cajas de 12'],
    ['kg', 'kg'],
    ['und', 'und'],
    ['lb.', 'lb.'],
  ])('%s → %s', (singular, plural) => {
    expect(unidadEnPlural(singular)).toBe(plural)
  })
})

describe('cantidadConSigno y pesos', () => {
  it('muestra el signo y el dinero con dos decimales', () => {
    expect(cantidadConSigno('20.000')).toBe('+20')
    expect(cantidadConSigno(-3)).toBe('-3')
    expect(cantidadConSigno(0)).toBe('0')
    expect(pesos('1700')).toBe('RD$ 1,700.00')
    expect(pesos(-823)).toBe('RD$ -823.00')
  })
})

describe('unirFrases', () => {
  it('no duplica el punto después de "a. m."', () => {
    expect(unirFrases(['Salió a las 8:10 a. m.', 'Notas del chofer'])).toBe(
      'Salió a las 8:10 a. m. Notas del chofer',
    )
    expect(unirFrases(['Uno', null, '  ', 'Dos'])).toBe('Uno. Dos')
  })
})
