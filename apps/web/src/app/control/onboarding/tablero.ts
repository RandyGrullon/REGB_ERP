/**
 * El tablero de onboarding sin la pantalla: etapas, filtro y movimientos.
 * Logica pura -lo importan el servidor y el componente del tablero- y
 * probada en tablero.test.ts.
 *
 * El filtro vive en la URL (`?q=...&tamano=pyme,grande`): se comparte el
 * enlace y sobrevive a recargar.
 */
import { TIERS, type Tier } from './alta'

export const ETAPAS = [
  { id: 'sold', label: 'Vendido' },
  { id: 'migration', label: 'Migración' },
  { id: 'config', label: 'Configuración' },
  { id: 'training', label: 'Capacitación' },
  { id: 'live', label: 'En vivo' },
] as const

export type EtapaId = (typeof ETAPAS)[number]['id']

export const esEtapa = (x: string): x is EtapaId => ETAPAS.some((e) => e.id === x)
export const nombreDeEtapa = (id: string): string => ETAPAS.find((e) => e.id === id)?.label ?? id

export interface TarjetaOnboarding {
  tenant_id: string
  slug: string
  legal_name: string
  trade_name: string | null
  tax_id: string | null
  tier: Tier
  stage: string
  blockers: string | null
  /** El dueño invitado todavia no entro (invitacion Owner pendiente, 0123). */
  dueno_pendiente: boolean
}

export interface FiltroTablero {
  q: string
  tamanos: Tier[]
}

export const TAMANO_TEXTO: Record<Tier, string> = {
  pyme: 'Pyme',
  mediano: 'Mediano',
  grande: 'Grande',
}
export const TAMANO_TONO = { pyme: 'success', mediano: 'info', grande: 'brand' } as const

const MAX_Q = 80

/** Lee el filtro de la query string. Lo que no es un tamaño se ignora. */
export function leerFiltro(p: {
  q?: string | string[]
  tamano?: string | string[]
}): FiltroTablero {
  const q = (Array.isArray(p.q) ? (p.q[0] ?? '') : (p.q ?? '')).trim().slice(0, MAX_Q)
  const crudos = (Array.isArray(p.tamano) ? p.tamano : [p.tamano ?? ''])
    .flatMap((x) => x.split(','))
    .map((x) => x.trim().toLowerCase())
  const tamanos = TIERS.filter((t) => crudos.includes(t))
  return { q, tamanos }
}

const normaliza = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

const soloDigitos = (s: string): string => s.replace(/\D/g, '')

function coincideTexto(t: TarjetaOnboarding, q: string): boolean {
  if (q === '') return true
  const nq = normaliza(q)
  const textos = [t.legal_name, t.trade_name ?? '', t.slug].map(normaliza)
  if (textos.some((x) => x.includes(nq))) return true
  // RNC: se compara digito a digito, con o sin guiones. Solo si lo que se
  // busco parece un numero, para que "srl" no case con cualquier RNC.
  const dq = soloDigitos(q)
  return /^[\d\s-]+$/.test(q) && dq.length >= 3 && soloDigitos(t.tax_id ?? '').includes(dq)
}

export function filtrarTarjetas(
  tarjetas: TarjetaOnboarding[],
  f: FiltroTablero,
): TarjetaOnboarding[] {
  return tarjetas.filter(
    (t) => coincideTexto(t, f.q) && (f.tamanos.length === 0 || f.tamanos.includes(t.tier)),
  )
}

/**
 * Cuantas tarjetas hay por tamaño con la busqueda aplicada y SIN el filtro
 * de tamaño: lo que dice el chip es "cuantos verias si lo marcas".
 */
export function conteoPorTamano(
  tarjetas: TarjetaOnboarding[],
  f: FiltroTablero,
): Record<Tier, number> {
  const base = filtrarTarjetas(tarjetas, { q: f.q, tamanos: [] })
  return Object.fromEntries(
    TIERS.map((t) => [t, base.filter((x) => x.tier === t).length]),
  ) as Record<Tier, number>
}

export function queryDeFiltro(f: FiltroTablero): string {
  const p = new URLSearchParams()
  if (f.q !== '') p.set('q', f.q)
  if (f.tamanos.length > 0) p.set('tamano', f.tamanos.join(','))
  const s = p.toString()
  return s === '' ? '' : `?${s}`
}

export function alternarTamano(f: FiltroTablero, t: Tier): FiltroTablero {
  const tamanos = f.tamanos.includes(t) ? f.tamanos.filter((x) => x !== t) : [...f.tamanos, t]
  return { q: f.q, tamanos: TIERS.filter((x) => tamanos.includes(x)) }
}

/** Flecha izquierda/derecha con la tarjeta enfocada: la etapa vecina, si hay. */
export function destinoConTeclado(etapa: string, tecla: string): EtapaId | null {
  const i = ETAPAS.findIndex((e) => e.id === etapa)
  if (i === -1) return null
  const j = tecla === 'ArrowRight' ? i + 1 : tecla === 'ArrowLeft' ? i - 1 : -1
  return ETAPAS[j]?.id ?? null
}
