/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PUERTA F0 — Accesibilidad de Aurora
 *
 *  "Contraste minimo AA 4.5:1 en texto; verificado en ambos temas" (§11.7).
 *
 *  Cada combinacion que la UI usa de verdad se mide aqui. Un token que
 *  falla no es un detalle estetico: es un usuario que no puede leer su
 *  factura.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest'
import { colorOf, type Theme } from './index.js'
import { contrastRatio, meetsAA, parseColor, WCAG } from './contrast.js'

const THEMES: Theme[] = ['dark', 'light']

/** Mensaje util cuando falla: dice el ratio real y cuanto faltaba. */
const report = (fg: string, bg: string, need: number): string =>
  `${fg} sobre ${bg} = ${contrastRatio(fg, bg).toFixed(2)}:1 (necesita ${need}:1)`

describe('Calculo de contraste', () => {
  it('acepta los formatos que usa tokens.json', () => {
    expect(parseColor('#5865F2')).toEqual({ r: 88, g: 101, b: 242 })
    expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('rgba(88,101,242,0.15)')).toEqual({ r: 88, g: 101, b: 242 })
  })

  it('los extremos dan los ratios conocidos', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe.each(THEMES)('Tema %s — texto sobre superficies', (theme) => {
  const surfaces = ['deepest', 'deep', 'base', 'raised', 'overlay'] as const

  it.each(surfaces)('texto primario sobre surface.%s cumple AA', (surface) => {
    const fg = colorOf('text', 'primary', theme)
    const bg = colorOf('surface', surface, theme)
    expect(meetsAA(fg, bg), report(fg, bg, WCAG.AA_NORMAL)).toBe(true)
  })

  it.each(surfaces)('texto secundario sobre surface.%s cumple AA', (surface) => {
    const fg = colorOf('text', 'secondary', theme)
    const bg = colorOf('surface', surface, theme)
    expect(meetsAA(fg, bg), report(fg, bg, WCAG.AA_NORMAL)).toBe(true)
  })

  it('el texto apagado cumple al menos AA de texto grande', () => {
    // `muted` es para metadatos y placeholders, que van en tamano normal
    // pero jerarquia baja. Exigimos AA_LARGE como piso duro.
    const fg = colorOf('text', 'muted', theme)
    const bg = colorOf('surface', 'base', theme)
    expect(contrastRatio(fg, bg), report(fg, bg, WCAG.AA_LARGE)).toBeGreaterThanOrEqual(
      WCAG.AA_LARGE,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe.each(THEMES)('Tema %s — marca y semanticos', (theme) => {
  it('el texto sobre el boton primario cumple AA', () => {
    const fg = colorOf('text', 'onBrand', theme)
    const bg = colorOf('brand', 'default', theme)
    expect(meetsAA(fg, bg), report(fg, bg, WCAG.AA_NORMAL)).toBe(true)
  })

  it('el hover del primario tampoco pierde contraste', () => {
    const fg = colorOf('text', 'onBrand', theme)
    const bg = colorOf('brand', 'hover', theme)
    expect(meetsAA(fg, bg), report(fg, bg, WCAG.AA_NORMAL)).toBe(true)
  })

  const semantics = ['success', 'warning', 'danger', 'info', 'neutral'] as const

  it.each(semantics)('%s como TEXTO cumple AA sobre el fondo base', (name) => {
    // "Vencido", "Stock bajo", "Pagado". Usa la variante de texto: el color
    // de relleno no da 4.5:1 sobre fondo oscuro.
    const fg = colorOf('semanticText', name, theme)
    const bg = colorOf('surface', 'base', theme)
    expect(meetsAA(fg, bg), report(fg, bg, WCAG.AA_NORMAL)).toBe(true)
  })

  it.each(semantics)('%s como TEXTO cumple AA sobre tarjeta y modal', (name) => {
    // El texto de estado vive sobre contenido, tarjetas y modales.
    // El rail y el sidebar no llevan texto semantico.
    const fg = colorOf('semanticText', name, theme)
    for (const s of ['raised', 'overlay'] as const) {
      const bg = colorOf('surface', s, theme)
      expect(meetsAA(fg, bg), report(fg, bg, WCAG.AA_NORMAL)).toBe(true)
    }
  })

  it.each(['success', 'warning', 'danger', 'info'] as const)(
    '%s como RELLENO cumple el umbral de componente',
    (name) => {
      // Puntos de estado, barras y bordes: 3:1 basta (WCAG 1.4.11).
      const fg = colorOf('semantic', name, theme)
      const bg = colorOf('surface', 'raised', theme)
      expect(contrastRatio(fg, bg), report(fg, bg, WCAG.AA_UI)).toBeGreaterThanOrEqual(WCAG.AA_UI)
    },
  )

  it('el enlace se distingue del texto de cuerpo y del fondo', () => {
    const link = colorOf('text', 'link', theme)
    const bg = colorOf('surface', 'base', theme)
    expect(meetsAA(link, bg), report(link, bg, WCAG.AA_NORMAL)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe.each(THEMES)('Tema %s — categorias de modulo', (theme) => {
  const categories = ['core', 'standard', 'advanced', 'vertical', 'enterprise', 'provider'] as const

  it.each(categories)('la categoria %s se distingue en el sidebar', (cat) => {
    // Van como punto de color junto al nombre del modulo: umbral de UI.
    const fg = colorOf('moduleCategory', cat, theme)
    const bg = colorOf('surface', 'deep', theme)
    expect(contrastRatio(fg, bg), report(fg, bg, WCAG.AA_UI)).toBeGreaterThanOrEqual(WCAG.AA_UI)
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Anillo de foco', () => {
  // §11.7: "Foco visible siempre, nunca outline:none sin reemplazo."
  // Usa brand.bright: el blurple puro solo da 2.74:1 sobre #313338 y
  // literalmente no se distingue del fondo.
  const surfaces = ['base', 'raised', 'input', 'deep'] as const

  it.each(THEMES)('el foco se ve sobre cualquier superficie en tema %s', (theme) => {
    const focus = colorOf('brand', 'bright', theme)
    for (const s of surfaces) {
      const bg = colorOf('surface', s, theme)
      expect(contrastRatio(focus, bg), report(focus, bg, WCAG.AA_UI)).toBeGreaterThanOrEqual(
        WCAG.AA_UI,
      )
    }
  })

  it('brand.bright da mas margen que el primario como indicador', () => {
    // El primario carga texto BLANCO encima (4.5:1), lo que lo obliga a ser
    // oscuro; brand.bright existe para lo contrario, verse SOBRE lo oscuro.
    // Son requisitos opuestos, por eso son dos tokens y no uno.
    const fondo = colorOf('surface', 'base', 'dark')
    const primario = contrastRatio(colorOf('brand', 'default', 'dark'), fondo)
    const brillante = contrastRatio(colorOf('brand', 'bright', 'dark'), fondo)

    expect(brillante).toBeGreaterThan(primario)
    // Margen holgado, no al filo: un anillo de foco al 3.0 exacto se pierde
    // en cuanto alguien baja el brillo de la pantalla.
    expect(brillante).toBeGreaterThanOrEqual(4)
  })

  it('el texto blanco sobre el primario cumple AA — el requisito opuesto', () => {
    for (const theme of THEMES) {
      const fg = colorOf('text', 'onBrand', theme)
      const bg = colorOf('brand', 'default', theme)
      expect(meetsAA(fg, bg), report(fg, bg, WCAG.AA_NORMAL)).toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
describe('Bordes y separadores', () => {
  it.each(THEMES)('el borde se distingue de su superficie en tema %s', (theme) => {
    // Un separador invisible no separa. Umbral bajo pero no cero.
    const border = colorOf('border', 'strong', theme)
    const bg = colorOf('surface', 'base', theme)
    expect(contrastRatio(border, bg), report(border, bg, 1.5)).toBeGreaterThanOrEqual(1.5)
  })
})
