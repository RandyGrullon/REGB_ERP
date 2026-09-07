import { describe, expect, it } from 'vitest'
import { explotarNecesidadesMrp, necesidadNeta, type NodoExplosionMrp } from './mrp'

describe('explotarNecesidadesMrp', () => {
  it('un solo nivel comprado: una hoja por componente', () => {
    const nodos: NodoExplosionMrp[] = [
      { productId: 'madera', cantidadNecesaria: 40, esComprado: true },
      { productId: 'tornillo', cantidadNecesaria: 80, esComprado: true },
    ]
    const r = explotarNecesidadesMrp(nodos)
    expect(r).toEqual(
      expect.arrayContaining([
        { productId: 'madera', cantidadBruta: 40, accion: 'purchase' },
        { productId: 'tornillo', cantidadBruta: 80, accion: 'purchase' },
      ]),
    )
  })

  it('un componente producido se expande a sus propios sub-componentes', () => {
    const nodos: NodoExplosionMrp[] = [
      {
        productId: 'pata',
        cantidadNecesaria: 4,
        esComprado: false,
        subComponentes: [
          { productId: 'madera', cantidadNecesaria: 4, esComprado: true },
          { productId: 'barniz', cantidadNecesaria: 2, esComprado: true },
        ],
      },
    ]
    const r = explotarNecesidadesMrp(nodos)
    expect(r).toEqual(
      expect.arrayContaining([
        { productId: 'pata', cantidadBruta: 4, accion: 'produce' },
        { productId: 'madera', cantidadBruta: 4, accion: 'purchase' },
        { productId: 'barniz', cantidadBruta: 2, accion: 'purchase' },
      ]),
    )
  })

  it('la misma materia prima en dos ramas distintas se SUMA, no se cuenta por separado', () => {
    const nodos: NodoExplosionMrp[] = [
      {
        productId: 'pata',
        cantidadNecesaria: 4,
        esComprado: false,
        subComponentes: [{ productId: 'tornillo', cantidadNecesaria: 8, esComprado: true }],
      },
      {
        productId: 'espaldar',
        cantidadNecesaria: 1,
        esComprado: false,
        subComponentes: [{ productId: 'tornillo', cantidadNecesaria: 4, esComprado: true }],
      },
    ]
    const r = explotarNecesidadesMrp(nodos)
    const tornillo = r.find((x) => x.productId === 'tornillo')
    expect(tornillo?.cantidadBruta).toBe(12)
  })

  it('un nodo comprado nunca se expande, aunque traiga sub-componentes por error', () => {
    const nodos: NodoExplosionMrp[] = [
      {
        productId: 'kit-comprado',
        cantidadNecesaria: 5,
        esComprado: true,
        subComponentes: [{ productId: 'no-deberia-aparecer', cantidadNecesaria: 99, esComprado: true }],
      },
    ]
    const r = explotarNecesidadesMrp(nodos)
    expect(r).toHaveLength(1)
    expect(r[0]!.productId).toBe('kit-comprado')
  })
})

describe('necesidadNeta', () => {
  it('bruta menos disponible', () => {
    expect(necesidadNeta(100, 30)).toBe(70)
  })

  it('nunca negativa -si sobra, cero-', () => {
    expect(necesidadNeta(30, 100)).toBe(0)
  })

  it('exactamente lo disponible: cero', () => {
    expect(necesidadNeta(50, 50)).toBe(0)
  })
})
