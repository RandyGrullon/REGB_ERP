/**
 * Formato compartido por la vitrina y la ficha del marketplace.
 *
 * Aqui solo hay presentacion: los precios ya vienen calculados para el
 * tier del cliente desde `loadCatalog`.
 */

export const TIER_LABEL: Record<string, string> = {
  pyme: 'PYME',
  mediano: 'Mediano',
  grande: 'Grande',
}

export const tierLabel = (tier: string): string => TIER_LABEL[tier] ?? tier

/** Montos enteros en dolares, con separador dominicano: 1,135. */
export const money = (n: number): string =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

/**
 * Montos de la factura, con centavos cuando los hay: con ITBIS casi nunca
 * sale redondo, y redondear lo que se va a cobrar es mentir un poco.
 */
export const moneda = (n: number): string =>
  n.toLocaleString('es-DO', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })

/** US$ con signo para montos de la factura (el descuento sale negativo). */
export const usd = (n: number): string => `${n < 0 ? '−' : ''}US$ ${moneda(Math.abs(n))}`

/** Dias que le quedan a una prueba; `null` si no hay fecha. */
export function diasRestantes(fin: string | null): number | null {
  if (!fin) return null
  return Math.max(0, Math.ceil((new Date(fin).getTime() - Date.now()) / 86_400_000))
}

export const plural = (n: number, uno: string, varios: string): string =>
  `${n} ${n === 1 ? uno : varios}`

/** Anillo de foco comun: el mismo en toda la zona, visible en los dos temas. */
export const FOCO =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'

/**
 * Botones pildora hechos a mano (para `<a>`, `BotonEnvio` y toggles, que
 * no pueden ser el `Button` de @regb/ui). 44px de alto en movil, 36px
 * desde `md`: objetivo tactil minimo sin inflar el escritorio.
 */
const PILL_BASE = `inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors duration-100 ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-50 md:h-9 ${FOCO}`

export const PILL_PRIMARIO = `${PILL_BASE} bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] active:bg-[var(--color-brand-active)]`

export const PILL_CONTORNO = `${PILL_BASE} border border-[var(--color-brand-bright)] text-[var(--color-text-link)] hover:bg-[var(--color-brand-soft)]`

export const PILL_FANTASMA = `${PILL_BASE} text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]`

/** Fecha corta y estable entre servidor y navegador (misma zona horaria). */
export const fechaCorta = (iso: string): string =>
  new Date(iso).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Santo_Domingo',
  })
