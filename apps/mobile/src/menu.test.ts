import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SECCIONES } from './menu.js'

/**
 * El menu del movil, contra la realidad del catalogo.
 *
 * ── Por que hace falta ────────────────────────────────────────────────
 *
 * Un `permiso` mal escrito NO da error. `can()` devuelve false, la
 * seccion desaparece del menu para todo el mundo y la app se ve
 * perfecta: solo que vacia. Es el mismo fallo silencioso que los tours
 * huerfanos de la web -moduleId inventado, tour que no se le enseña a
 * nadie- y se detecta igual: cruzando con la fuente de verdad.
 *
 * Se leen los manifests como TEXTO en vez de importarlos. Es feo y es a
 * proposito: importarlos aqui arrastra el registry entero a las pruebas
 * del movil, y lo unico que hace falta saber es si una cadena esta
 * declarada.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function manifiesto(moduleId: string): string | null {
  const p = join(RAIZ, 'modules', moduleId, 'manifest.ts')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

describe('Las secciones del menu movil', () => {
  it('hay secciones que comprobar', () => {
    expect(SECCIONES.length).toBeGreaterThan(0)
  })

  it('cada una apunta a un modulo del catalogo', () => {
    const huerfanas = SECCIONES.filter((s) => manifiesto(s.moduleId) === null).map((s) => s.titulo)
    expect(huerfanas).toEqual([])
  })

  it('y cada permiso lo declara ESE modulo', () => {
    // Si esto se cae: o el permiso tiene un error de escritura, o la
    // seccion esta pidiendo un permiso de otro modulo -que `can()`
    // evalua contra el modulo equivocado y siempre deniega-.
    const inventadas = SECCIONES.filter((s) => {
      const m = manifiesto(s.moduleId)
      return m !== null && !m.includes(`'${s.permiso}'`)
    }).map((s) => `${s.titulo} -> ${s.permiso}`)
    expect(inventadas).toEqual([])
  })

  it('las rutas son absolutas y del grupo (app)', () => {
    for (const s of SECCIONES) {
      expect(s.ruta.startsWith('/(app)/'), s.titulo).toBe(true)
    }
  })

  it('no hay dos secciones con la misma ruta', () => {
    expect(new Set(SECCIONES.map((s) => s.ruta)).size).toBe(SECCIONES.length)
  })

  it('todas tienen descripcion util, no un relleno', () => {
    for (const s of SECCIONES) {
      expect(s.descripcion.length, s.titulo).toBeGreaterThan(20)
    }
  })
})
