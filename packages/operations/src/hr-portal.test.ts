import { describe, expect, it } from 'vitest'
import { esAnuncioVigente } from './hr-portal.js'

describe('esAnuncioVigente', () => {
  it('un anuncio publicado hoy es vigente', () => {
    const hoy = new Date(2026, 0, 15)
    expect(esAnuncioVigente(hoy, hoy)).toBe(true)
  })

  it('un anuncio dentro del margen de dias sigue vigente', () => {
    const publicado = new Date(2026, 0, 1)
    const hoy = new Date(2026, 0, 10)
    expect(esAnuncioVigente(publicado, hoy, 14)).toBe(true)
  })

  it('un anuncio que ya paso el margen deja de ser vigente', () => {
    const publicado = new Date(2026, 0, 1)
    const hoy = new Date(2026, 0, 20)
    expect(esAnuncioVigente(publicado, hoy, 14)).toBe(false)
  })

  it('respeta un margen de vigencia distinto si se pasa como parametro', () => {
    const publicado = new Date(2026, 0, 1)
    const hoy = new Date(2026, 0, 4)
    expect(esAnuncioVigente(publicado, hoy, 2)).toBe(false)
    expect(esAnuncioVigente(publicado, hoy, 5)).toBe(true)
  })

  it('un anuncio "publicado" en el futuro -reloj desincronizado- no cuenta como vigente', () => {
    const publicado = new Date(2026, 0, 20)
    const hoy = new Date(2026, 0, 10)
    expect(esAnuncioVigente(publicado, hoy)).toBe(false)
  })
})
