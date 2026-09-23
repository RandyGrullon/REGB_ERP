import { describe, expect, it } from 'vitest'
import {
  alternarTamano,
  conteoPorTamano,
  destinoConTeclado,
  ETAPAS,
  filtrarTarjetas,
  leerFiltro,
  queryDeFiltro,
  type TarjetaOnboarding,
} from './tablero'

/**
 * El filtro del tablero de onboarding: por nombre (razon social, nombre
 * comercial, identificador o RNC) y por tamaño (tier), combinables, y
 * vivo en la URL para compartir el enlace y sobrevivir a recargar.
 */

const t = (
  slug: string,
  legal: string,
  tier: TarjetaOnboarding['tier'],
  extra: Partial<TarjetaOnboarding> = {},
): TarjetaOnboarding => ({
  tenant_id: `id-${slug}`,
  slug,
  legal_name: legal,
  trade_name: null,
  tax_id: null,
  tier,
  stage: 'sold',
  blockers: null,
  dueno_pendiente: false,
  ...extra,
})

const TARJETAS = [
  t('colmado-esperanza', 'Colmado La Esperanza SRL', 'pyme', { tax_id: '130-11111-1' }),
  t('distribuidora-caribe', 'Distribuidora Caribe SRL', 'mediano', {
    trade_name: 'DisCaribe',
    tax_id: '131-45678-2',
  }),
  t('grupo-cibao', 'Grupo Económico del Cibao', 'grande'),
  t('ferreteria-norte', 'Ferreteria del Norte', 'pyme'),
]

describe('leerFiltro', () => {
  it('toma q y los tamaños validos, sin repetir y en el orden de los planes', () => {
    expect(leerFiltro({ q: '  caribe ', tamano: 'grande,pyme,pyme,foo' })).toEqual({
      q: 'caribe',
      tamanos: ['pyme', 'grande'],
    })
  })

  it('acepta el parametro repetido (?tamano=pyme&tamano=mediano)', () => {
    expect(leerFiltro({ tamano: ['mediano', 'pyme'] }).tamanos).toEqual(['pyme', 'mediano'])
  })

  it('sin parametros no filtra nada', () => {
    expect(leerFiltro({})).toEqual({ q: '', tamanos: [] })
  })

  it('una busqueda larguisima se corta: la URL no es un deposito', () => {
    expect(leerFiltro({ q: 'x'.repeat(500) }).q).toHaveLength(80)
  })
})

describe('filtrarTarjetas', () => {
  it('por razon social, sin mayusculas ni acentos', () => {
    expect(filtrarTarjetas(TARJETAS, { q: 'economico', tamanos: [] }).map((x) => x.slug)).toEqual([
      'grupo-cibao',
    ])
  })

  it('por nombre comercial y por identificador', () => {
    expect(filtrarTarjetas(TARJETAS, { q: 'discaribe', tamanos: [] }).map((x) => x.slug)).toEqual([
      'distribuidora-caribe',
    ])
    expect(
      filtrarTarjetas(TARJETAS, { q: 'ferreteria-n', tamanos: [] }).map((x) => x.slug),
    ).toEqual(['ferreteria-norte'])
  })

  it('por RNC, con o sin guiones', () => {
    expect(filtrarTarjetas(TARJETAS, { q: '13145678', tamanos: [] }).map((x) => x.slug)).toEqual([
      'distribuidora-caribe',
    ])
    expect(filtrarTarjetas(TARJETAS, { q: '130-11111', tamanos: [] }).map((x) => x.slug)).toEqual([
      'colmado-esperanza',
    ])
  })

  it('por tamaño, y varios tamaños se suman', () => {
    expect(filtrarTarjetas(TARJETAS, { q: '', tamanos: ['pyme'] }).map((x) => x.slug)).toEqual([
      'colmado-esperanza',
      'ferreteria-norte',
    ])
    expect(filtrarTarjetas(TARJETAS, { q: '', tamanos: ['pyme', 'grande'] })).toHaveLength(3)
  })

  it('nombre y tamaño se combinan', () => {
    expect(filtrarTarjetas(TARJETAS, { q: 'srl', tamanos: ['pyme'] }).map((x) => x.slug)).toEqual([
      'colmado-esperanza',
    ])
  })
})

describe('conteoPorTamano', () => {
  it('cuenta por tamaño con la busqueda aplicada, sin mirar el tamaño elegido', () => {
    // Asi el chip dice cuantos habria si lo marcas.
    expect(conteoPorTamano(TARJETAS, { q: 'srl', tamanos: ['grande'] })).toEqual({
      pyme: 1,
      mediano: 1,
      grande: 0,
    })
  })
})

describe('la URL del filtro', () => {
  it('queryDeFiltro arma el enlace y omite lo vacio', () => {
    expect(queryDeFiltro({ q: 'caribe', tamanos: ['pyme', 'grande'] })).toBe(
      '?q=caribe&tamano=pyme%2Cgrande',
    )
    expect(queryDeFiltro({ q: '', tamanos: [] })).toBe('')
  })

  it('alternarTamano marca y desmarca sin perder la busqueda', () => {
    expect(alternarTamano({ q: 'x', tamanos: ['pyme'] }, 'grande')).toEqual({
      q: 'x',
      tamanos: ['pyme', 'grande'],
    })
    expect(alternarTamano({ q: 'x', tamanos: ['pyme', 'grande'] }, 'pyme')).toEqual({
      q: 'x',
      tamanos: ['grande'],
    })
  })
})

describe('mover con el teclado', () => {
  it('flecha derecha e izquierda van a la etapa vecina; en los bordes no hay destino', () => {
    expect(ETAPAS.map((e) => e.id)).toEqual(['sold', 'migration', 'config', 'training', 'live'])
    expect(destinoConTeclado('sold', 'ArrowRight')).toBe('migration')
    expect(destinoConTeclado('config', 'ArrowLeft')).toBe('migration')
    expect(destinoConTeclado('sold', 'ArrowLeft')).toBeNull()
    expect(destinoConTeclado('live', 'ArrowRight')).toBeNull()
    expect(destinoConTeclado('sold', 'Enter')).toBeNull()
  })
})
