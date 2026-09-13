import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOURS, toursFor, type Tour } from './tours.js'

/**
 * "Cada modulo trae su propio tour" (§2, fila 5) es una PROMESA DE VENTA:
 * es lo que sustituye al consultor de implementacion. Sin una prueba que
 * la mida, "faltan tours" es una sensacion y no un numero.
 *
 * La lista de modulos sale de `modules/`, no de una constante copiada: si
 * alguien agrega un modulo al catalogo, esta prueba se pone roja sola y
 * dice cual falta.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function modulosDelCatalogo(): string[] {
  return readdirSync(join(RAIZ, 'modules'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
}

const conTour = new Set(TOURS.map((t) => t.moduleId))
const sinTour = modulosDelCatalogo().filter((m) => !conTour.has(m))

describe('Cobertura de tours', () => {
  it('el catalogo se lee de disco y no esta vacio', () => {
    expect(modulosDelCatalogo().length).toBeGreaterThan(70)
  })

  /**
   * El numero baja segun se van escribiendo. Cuando llegue a cero, esta
   * prueba se cambia por la de abajo -que ya esta escrita y saltada- y la
   * puerta F2 queda cerrada de verdad.
   *
   * Se afirma `toBeLessThanOrEqual` y NO una igualdad: una igualdad
   * obligaria a tocar la prueba en cada tour nuevo, y una prueba que hay
   * que editar para que siga pasando deja de vigilar nada.
   */
  it('la deuda de tours no crece', () => {
    expect(sinTour.length).toBeLessThanOrEqual(39)
  })

  it.skip('TODO modulo del catalogo tiene tour', () => {
    expect(sinTour).toEqual([])
  })
})

describe('Cada tour cumple lo que promete el tutorial', () => {
  const revisar = (t: Tour) => {
    it(`${t.id} esta bien formado`, () => {
      expect(t.id).toMatch(/^[a-z0-9]+\.[a-z0-9-]+$/)
      expect(t.title.length).toBeGreaterThan(5)
      expect(t.summary.length).toBeGreaterThan(10)
      expect(t.xp).toBeGreaterThan(0)

      // Menos de cuatro pasos no es un tour, es un tooltip.
      expect(t.steps.length).toBeGreaterThanOrEqual(4)

      // Al menos uno lleva a algun sitio: un tour que solo se lee no
      // ensena a usar nada.
      expect(t.steps.some((s) => s.action !== undefined)).toBe(true)

      for (const s of t.steps) {
        expect(s.title.length).toBeGreaterThan(3)
        expect(s.body.length).toBeGreaterThan(20)
        // Las rutas son relativas y sin query: el motor las compone.
        if (s.action) {
          expect(s.action.path.startsWith('/')).toBe(true)
          expect(s.action.path).not.toContain('?')
        }
      }
    })
  }
  for (const t of TOURS) revisar(t)

  it('no hay dos tours con el mismo id', () => {
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length)
  })
})

describe('Un tour de un modulo no licenciado no se ensena', () => {
  it('filtra por los modulos del tenant', () => {
    const soloInventario = toursFor(new Set(['inventory']))
    expect(soloInventario.every((t) => t.moduleId === 'inventory')).toBe(true)
  })

  it('sin modulos, sin tours', () => {
    expect(toursFor(new Set())).toEqual([])
  })
})
