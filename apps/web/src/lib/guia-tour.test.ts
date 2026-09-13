import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOURS } from '@regb/core'

/**
 * Todo destino de un tour tiene que poder pintar la guia.
 *
 * ── Por que hace falta comprobarlo ────────────────────────────────────
 *
 * La guia se monta en `modulePage`, el embudo por donde pasan las
 * pantallas de modulo. Parecia suficiente. No lo era: hay 14 pantallas
 * que NO pintan el Shell -ocupan el ancho entero- y dos de ellas,
 * /roles y /marketplace, son destino de tres tours.
 *
 * El fallo no tenia sintoma. La pantalla cargaba bien, el tour
 * sencillamente desaparecia al llegar: el usuario se quedaba plantado
 * sin saber que el tutorial seguia. Se encontro mirandolo en vivo, no
 * con una prueba, y por eso existe esta.
 *
 * Se comprueba estaticamente -leyendo el archivo de cada ruta- en vez de
 * levantando el servidor: asi corre en la puerta F0 sin necesitar base
 * de datos ni navegador.
 */
const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app')

/** El `page.tsx` de una ruta, o null si la ruta es dinamica o no existe. */
function archivoDeRuta(ruta: string): string | null {
  const rel = ruta.replace(/^\//, '')
  const p = rel === '' ? join(APP, 'page.tsx') : join(APP, ...rel.split('/'), 'page.tsx')
  return existsSync(p) ? p : null
}

/** Una pantalla pinta la guia si usa el Shell o si la monta a mano. */
function pintaLaGuia(archivo: string): boolean {
  const src = readFileSync(archivo, 'utf8')
  return src.includes('<Shell') || src.includes('GuiaFlotante')
}

const destinos = [
  ...new Set(
    TOURS.flatMap((t) => t.steps.flatMap((s) => (s.action ? [s.action.path] : []))),
  ),
].sort()

describe('Los destinos de los tours', () => {
  it('hay destinos que comprobar', () => {
    expect(destinos.length).toBeGreaterThan(20)
  })

  it('todos apuntan a una ruta que existe', () => {
    // Un `action.path` a una ruta inexistente manda al usuario a un 404
    // en medio del tutorial. Es el peor momento posible para un 404.
    expect(destinos.filter((d) => archivoDeRuta(d) === null)).toEqual([])
  })

  it('y todos pueden pintar la guia del tour', () => {
    const mudos = destinos.filter((d) => {
      const f = archivoDeRuta(d)
      return f !== null && !pintaLaGuia(f)
    })
    expect(mudos).toEqual([])
  })
})
