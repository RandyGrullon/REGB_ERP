import { describe, expect, it } from 'vitest'
import {
  clasificarAbc,
  frecuenciaConteoDias,
  proximoConteoVencido,
  transicionValidaConteo,
} from './stock-counts'

describe('clasificarAbc', () => {
  it('el 80% acumulado del valor es clase A', () => {
    const productos = [
      { productId: 'top', valorAnual: 800 },
      { productId: 'medio', valorAnual: 150 },
      { productId: 'bajo', valorAnual: 50 },
    ]
    const r = clasificarAbc(productos)
    expect(r.find((x) => x.productId === 'top')!.clase).toBe('A')
  })

  it('entre 80% y 95% acumulado es clase B', () => {
    const productos = [
      { productId: 'top', valorAnual: 800 },
      { productId: 'medio', valorAnual: 150 },
      { productId: 'bajo', valorAnual: 50 },
    ]
    const r = clasificarAbc(productos)
    expect(r.find((x) => x.productId === 'medio')!.clase).toBe('B')
  })

  it('el resto es clase C', () => {
    const productos = [
      { productId: 'top', valorAnual: 800 },
      { productId: 'medio', valorAnual: 150 },
      { productId: 'bajo', valorAnual: 50 },
    ]
    const r = clasificarAbc(productos)
    expect(r.find((x) => x.productId === 'bajo')!.clase).toBe('C')
  })

  it('es proporcion de VALOR acumulado, no de cantidad de productos', () => {
    // Un solo producto domina el 90% del valor: todos los demas caen en B/C
    // aunque sean 9 productos contra 1 -no es "el primer 33% de la lista"-.
    const productos = [
      { productId: 'gigante', valorAnual: 900 },
      ...Array.from({ length: 9 }, (_, i) => ({ productId: `chico-${i}`, valorAnual: 100 / 9 })),
    ]
    const r = clasificarAbc(productos)
    expect(r.filter((x) => x.clase === 'A')).toHaveLength(1)
  })

  it('sin valor total, todo cae en C -no hay division por cero-', () => {
    const productos = [
      { productId: 'a', valorAnual: 0 },
      { productId: 'b', valorAnual: 0 },
    ]
    const r = clasificarAbc(productos)
    expect(r.every((x) => x.clase === 'C')).toBe(true)
  })
})

describe('frecuenciaConteoDias', () => {
  it('A cada 30 dias, B cada 90, C cada 180', () => {
    expect(frecuenciaConteoDias('A')).toBe(30)
    expect(frecuenciaConteoDias('B')).toBe(90)
    expect(frecuenciaConteoDias('C')).toBe(180)
  })
})

describe('proximoConteoVencido', () => {
  it('nunca contado: vencido de una vez', () => {
    expect(proximoConteoVencido(null, 30, new Date('2026-06-01'))).toBe(true)
  })

  it('dentro de la frecuencia: no vencido', () => {
    expect(proximoConteoVencido(new Date('2026-05-20'), 30, new Date('2026-06-01'))).toBe(false)
  })

  it('fuera de la frecuencia: vencido', () => {
    expect(proximoConteoVencido(new Date('2026-04-01'), 30, new Date('2026-06-01'))).toBe(true)
  })
})

describe('transicionValidaConteo', () => {
  it('counting pide aprobacion', () => {
    expect(transicionValidaConteo('counting', 'pending_approval')).toBe(true)
  })

  it('pending_approval se aprueba o se rechaza', () => {
    expect(transicionValidaConteo('pending_approval', 'approved')).toBe(true)
    expect(transicionValidaConteo('pending_approval', 'rejected')).toBe(true)
  })

  it('no se salta de counting directo a approved', () => {
    expect(transicionValidaConteo('counting', 'approved')).toBe(false)
  })

  it('approved y rejected son terminales', () => {
    expect(transicionValidaConteo('approved', 'counting')).toBe(false)
    expect(transicionValidaConteo('rejected', 'counting')).toBe(false)
  })
})
