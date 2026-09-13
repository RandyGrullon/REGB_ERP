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
   * La puerta F2, cerrada. Se llego aqui desde 9 de 78.
   *
   * Ya no hay numero de deuda que ajustar a mano: o estan todos, o esto
   * se pone rojo y dice cual falta. La lista sale de `modules/` en disco,
   * asi que un modulo nuevo sin tour rompe la prueba el mismo dia que se
   * crea, no el dia que alguien se acuerde de mirar.
   */
  it('TODO modulo del catalogo tiene tour', () => {
    expect(sinTour).toEqual([])
  })

  it('y ningun tour apunta a un modulo que no existe', () => {
    // `toursFor` filtra por los modulos licenciados del tenant: un tour
    // con un moduleId inventado no se le enseña NUNCA a nadie, y no hay
    // nada que lo delate salvo esta prueba. Paso con dos ('rbac' y
    // 'marketplace'), escritos y mantenidos para nadie.
    const catalogo = new Set(modulosDelCatalogo())
    const huerfanos = TOURS.filter((t) => !catalogo.has(t.moduleId)).map((t) => t.id)
    expect(huerfanos).toEqual([])
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
    // El modulo se SACA de los datos en vez de escribirlo aqui.
    //
    // No es coqueteria: `audit:registry` prohibe que el core nombre un
    // modulo concreto -"el core no conoce los modulos", §2.2- y esta
    // prueba vive en el core. Escribir 'inventory' a mano ponia la
    // puerta F0 en rojo, y con razon: si manana ese modulo se renombra o
    // sale del catalogo, una prueba con el id escrito se rompe sin que
    // nada este mal.
    const uno = TOURS[0]!.moduleId
    const filtrados = toursFor(new Set([uno]))
    expect(filtrados.length).toBeGreaterThan(0)
    expect(filtrados.every((t) => t.moduleId === uno)).toBe(true)
  })

  it('sin modulos, sin tours', () => {
    expect(toursFor(new Set())).toEqual([])
  })
})
