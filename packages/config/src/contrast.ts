/**
 * Calculo de contraste WCAG 2.1.
 *
 * La puerta F0 exige AA (4.5:1) en texto normal, en LOS DOS temas.
 * Verificarlo a ojo no es verificarlo: esto lo mide.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Acepta `#RGB`, `#RRGGBB` y `rgba(r,g,b,a)`. */
export function parseColor(color: string): Rgb | null {
  const c = color.trim()

  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c)
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) }
  }

  const hex = c.replace('#', '')
  if (hex.length === 3) {
    const [r, g, b] = [...hex].map((ch) => parseInt(ch + ch, 16))
    return r === undefined || g === undefined || b === undefined ? null : { r, g, b }
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  return null
}

/** Luminancia relativa segun WCAG 2.1. */
export function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Ratio de contraste entre dos colores. De 1 (identicos) a 21 (blanco/negro). */
export function contrastRatio(fg: string, bg: string): number {
  const a = parseColor(fg)
  const b = parseColor(bg)
  if (!a || !b) return 0

  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export const WCAG = {
  /** Texto normal, nivel AA. */
  AA_NORMAL: 4.5,
  /** Texto grande (>=18.66px bold o >=24px), nivel AA. */
  AA_LARGE: 3,
  /** Componentes de interfaz y graficos, nivel AA. */
  AA_UI: 3,
  /** Texto normal, nivel AAA. */
  AAA_NORMAL: 7,
} as const

export function meetsAA(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) >= (large ? WCAG.AA_LARGE : WCAG.AA_NORMAL)
}
