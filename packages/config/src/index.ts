/**
 * Acceso tipado a los tokens de Aurora.
 *
 * Web usa las variables CSS de dist/tokens.css.
 * React Native no tiene variables CSS: consume estos objetos.
 * Ambos salen del mismo tokens.json, asi que no pueden divergir.
 */
import tokensJson from '../tokens.json' with { type: 'json' }

export const tokens = tokensJson

export type Theme = 'dark' | 'light'

type ColorGroup = keyof typeof tokensJson.color

/**
 * Resuelve un color para un tema concreto.
 *
 * @example colorOf('brand', 'default', 'dark')  // '#5865F2'
 * @example colorOf('semantic', 'danger', 'light') // '#D02B2F'
 */
export function colorOf<G extends ColorGroup>(
  group: G,
  name: keyof (typeof tokensJson.color)[G],
  theme: Theme = 'dark',
): string {
  const entry = tokensJson.color[group][name] as { dark: string; light: string }
  return entry[theme]
}

/** Paleta completa aplanada para un tema — la consume React Native. */
export function paletteFor(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [group, entries] of Object.entries(tokensJson.color)) {
    for (const [name, val] of Object.entries(entries as Record<string, Record<Theme, string>>)) {
      if (name.startsWith('$')) continue // notas para humanos, no tokens
      const key = name === 'default' ? group : `${group}.${name}`
      out[key] = val[theme]
    }
  }
  return out
}

export * from './contrast.js'

export const space = tokensJson.space
export const radius = tokensJson.radius
export const layout = tokensJson.layout
export const breakpoint = tokensJson.breakpoint
export const motion = tokensJson.motion
export const font = tokensJson.font
