import { describe, expect, it } from 'vitest'
import {
  POCAS_UNIDADES,
  agruparPorProducto,
  esCodigoExacto,
  filtrarExistencias,
  semaforo,
  textoSemaforo,
  type ExistenciaMovil,
} from './existencias-movil.js'

const fila = (p: Partial<ExistenciaMovil> = {}): ExistenciaMovil => ({
  productId: 'p1',
  sku: 'TV-55-SAM',
  nombre: 'Televisor Samsung 55"',
  barcode: '7891234567890',
  almacen: 'Principal',
  cantidad: 10,
  reservado: 0,
  precio: 32500,
  ...p,
})

describe('Disponible no es lo mismo que lo que hay', () => {
  it('descuenta lo reservado', () => {
    // Cinco en almacen y cinco apartados para un pedido confirmado es
    // cero vendible. Prometerselo a alguien en el mostrador es como se
    // incumple una entrega.
    const [r] = agruparPorProducto([fila({ cantidad: 5, reservado: 5 })])
    expect(r!.total).toBe(5)
    expect(r!.disponible).toBe(0)
  })

  it('suma los almacenes pero los conserva por separado', () => {
    const r = agruparPorProducto([
      fila({ almacen: 'Principal', cantidad: 2, reservado: 0 }),
      fila({ almacen: 'Sucursal Este', cantidad: 7, reservado: 1 }),
    ])
    expect(r).toHaveLength(1)
    expect(r[0]!.total).toBe(9)
    expect(r[0]!.disponible).toBe(8)
    expect(r[0]!.porAlmacen).toHaveLength(2)
  })

  it('pone primero el almacen con mas disponible: es al que hay que ir', () => {
    const [r] = agruparPorProducto([
      fila({ almacen: 'Deposito', cantidad: 1 }),
      fila({ almacen: 'Principal', cantidad: 9 }),
    ])
    expect(r!.porAlmacen[0]!.almacen).toBe('Principal')
  })
})

describe('Una sola caja de busqueda', () => {
  const datos = [
    fila(),
    fila({ productId: 'p2', sku: 'NEV-LG-18', nombre: 'Nevera LG 18 pies', barcode: '7899999999999' }),
    fila({ productId: 'p3', sku: 'CBL-HDMI-2', nombre: 'Cable HDMI 2m', barcode: null }),
  ]

  it('busca por nombre sin importar mayusculas', () => {
    expect(filtrarExistencias(datos, 'nevera')).toHaveLength(1)
    expect(filtrarExistencias(datos, 'NEVERA')).toHaveLength(1)
  })

  it('busca por SKU parcial', () => {
    expect(filtrarExistencias(datos, 'cbl')[0]?.nombre).toBe('Cable HDMI 2m')
  })

  it('el codigo de barras se compara COMPLETO, no por fragmento', () => {
    // Un lector bluetooth teclea el codigo entero de un golpe. Si se
    // buscara por fragmento, mientras teclea devolveria media tienda.
    expect(filtrarExistencias(datos, '7891234567890')).toHaveLength(1)
    expect(filtrarExistencias(datos, '789')).toHaveLength(0)
  })

  it('un producto sin codigo de barras no rompe la busqueda', () => {
    expect(() => filtrarExistencias(datos, '7899999999999')).not.toThrow()
    expect(filtrarExistencias(datos, '7899999999999')[0]?.sku).toBe('NEV-LG-18')
  })

  it('sin texto devuelve todo', () => {
    expect(filtrarExistencias(datos, '   ')).toHaveLength(3)
  })

  it('reconoce cuando lo escrito ES un codigo', () => {
    expect(esCodigoExacto(datos, '7891234567890')).toBe(true)
    expect(esCodigoExacto(datos, 'televisor')).toBe(false)
    expect(esCodigoExacto(datos, '')).toBe(false)
  })
})

describe('El semaforo que ve el vendedor', () => {
  it('cero o menos es agotado', () => {
    expect(semaforo(0)).toBe('nada')
    // Negativo no deberia pasar, pero si pasa se dice "agotado" y no se
    // pinta un numero en rojo que nadie sabe interpretar.
    expect(semaforo(-2)).toBe('nada')
    expect(textoSemaforo(0)).toBe('Agotado')
  })

  it('por debajo del umbral avisa con el numero exacto', () => {
    expect(semaforo(POCAS_UNIDADES - 1)).toBe('poco')
    expect(textoSemaforo(2)).toBe('Quedan 2')
  })

  it('a partir del umbral es hay', () => {
    expect(semaforo(POCAS_UNIDADES)).toBe('hay')
    expect(textoSemaforo(12)).toBe('12 disponibles')
  })

  it('el texto siempre lleva el numero, nunca solo el color', () => {
    // Ley de Aurora: el estado no se comunica solo por color. En un
    // telefono al sol, el color es justo lo primero que se pierde.
    for (const n of [0, 1, 5, 99]) expect(textoSemaforo(n)).toMatch(/\d|Agotado/)
  })
})
