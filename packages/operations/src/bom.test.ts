import { describe, expect, it } from 'vitest'
import { costoUnitarioMultinivel, elegirComponente, explotarCantidad, type NodoBom } from './bom'

describe('costoUnitarioMultinivel', () => {
  it('un componente sin sub-receta cuesta su costo directo', () => {
    const hoja: NodoBom = { productId: 'tornillo', cantidadPorUnidad: 1, costoDirecto: 2 }
    expect(costoUnitarioMultinivel(hoja)).toBe(2)
  })

  it('un solo nivel: suma cantidad por costo de cada componente', () => {
    const producto: NodoBom = {
      productId: 'silla',
      cantidadPorUnidad: 1,
      costoDirecto: 0,
      subComponentes: [
        { productId: 'madera', cantidadPorUnidad: 4, costoDirecto: 50 },
        { productId: 'tornillo', cantidadPorUnidad: 8, costoDirecto: 2 },
      ],
    }
    // 4*50 + 8*2 = 200 + 16 = 216
    expect(costoUnitarioMultinivel(producto)).toBe(216)
  })

  it('multinivel real: un componente con su propia receta se resuelve recursivamente', () => {
    const pataDeSilla: NodoBom = {
      productId: 'pata',
      cantidadPorUnidad: 4,
      costoDirecto: 0,
      subComponentes: [
        { productId: 'madera', cantidadPorUnidad: 1, costoDirecto: 30 },
        { productId: 'barniz', cantidadPorUnidad: 0.5, costoDirecto: 10 },
      ],
    }
    const silla: NodoBom = {
      productId: 'silla',
      cantidadPorUnidad: 1,
      costoDirecto: 0,
      subComponentes: [pataDeSilla, { productId: 'tornillo', cantidadPorUnidad: 8, costoDirecto: 2 }],
    }
    // pata: 1*30 + 0.5*10 = 35 por pata; silla usa 4 patas: 4*35 = 140
    // tornillos: 8*2 = 16
    // total: 156
    expect(costoUnitarioMultinivel(silla)).toBe(156)
  })
})

describe('explotarCantidad', () => {
  it('multiplica cantidad por unidad por la cantidad deseada', () => {
    expect(explotarCantidad(4, 10)).toBe(40)
  })
})

describe('elegirComponente', () => {
  it('el principal alcanza: usa el principal', () => {
    expect(elegirComponente(10, 20, 0)).toBe('principal')
  })

  it('el principal no alcanza pero el sustituto si: usa el sustituto', () => {
    expect(elegirComponente(10, 5, 20)).toBe('sustituto')
  })

  it('ninguno alcanza: faltante real', () => {
    expect(elegirComponente(10, 5, 3)).toBe('faltante')
  })

  it('exactamente en el limite, el principal alcanza', () => {
    expect(elegirComponente(10, 10, 0)).toBe('principal')
  })
})
