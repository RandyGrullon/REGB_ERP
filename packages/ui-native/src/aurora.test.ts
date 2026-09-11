import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { conAlfa, temaClaro, temaOscuro } from './tokens'

/**
 * Prueba de humo de Aurora en nativo.
 *
 * No mide pixeles: vigila la unica regla que un componente puede romper
 * en silencio, que es escribir un color a mano en vez de pedirlo a
 * tokens.json. El unico archivo donde puede aparecer un hex es tokens.ts,
 * y ahi tampoco escrito: leido.
 */
const RAIZ = join(import.meta.dirname, '.')
const PERMITIDOS = new Set(['tokens.ts'])

function archivosDeFuente(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(carpeta, entrada.name)
    if (entrada.isDirectory()) return archivosDeFuente(ruta)
    if (!entrada.name.endsWith('.ts') && !entrada.name.endsWith('.tsx')) return []
    if (entrada.name.endsWith('.test.ts')) return []
    if (PERMITIDOS.has(entrada.name)) return []
    return [ruta]
  })
}

describe('cero hex a mano', () => {
  it('ningun componente escribe un color literal', () => {
    const culpables = archivosDeFuente(RAIZ).filter((ruta) =>
      /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(readFileSync(ruta, 'utf8')),
    )

    expect(culpables).toEqual([])
  })
})

describe('los dos temas', () => {
  it('traen los mismos grupos de color y ninguno vacio', () => {
    for (const tema of [temaClaro, temaOscuro]) {
      for (const grupo of Object.values(tema.color)) {
        for (const valor of Object.values(grupo)) {
          expect(valor).toMatch(/^(#|rgba?\()/)
        }
      }
    }
  })

  it('el area tactil minima es de 44 px', () => {
    expect(temaOscuro.disposicion.areaTactil).toBeGreaterThanOrEqual(44)
  })
})

describe('conAlfa', () => {
  it('convierte un hex de 6 digitos a rgba', () => {
    expect(conAlfa('#3B82F6', 0.18)).toBe('rgba(59, 130, 246, 0.18)')
  })

  it('expande un hex de 3 digitos', () => {
    expect(conAlfa('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)')
  })

  it('no le pisa la opacidad a un color que ya trae alfa', () => {
    expect(conAlfa('rgba(88, 101, 242, 0.15)', 0.9)).toBe('rgba(88, 101, 242, 0.15)')
  })
})
