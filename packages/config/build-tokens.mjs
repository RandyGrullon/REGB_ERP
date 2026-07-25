#!/usr/bin/env node
/**
 * Genera dist/tokens.css a partir de tokens.json.
 *
 * Una sola fuente de verdad: si un color cambia aqui, cambia en web,
 * desktop y movil a la vez. Ver documento maestro §11 y §15.2.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))
const tokens = JSON.parse(await readFile(join(DIR, 'tokens.json'), 'utf8'))

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** Recorre color.* y emite `--color-<grupo>-<nombre>` para un tema. */
function colorVars(theme) {
  const out = []
  for (const [group, entries] of Object.entries(tokens.color)) {
    for (const [name, val] of Object.entries(entries)) {
      if (name.startsWith('$')) continue // notas para humanos, no tokens
      const suffix = name === 'default' ? '' : `-${kebab(name)}`
      out.push(`  --color-${kebab(group)}${suffix}: ${val[theme]};`)
    }
  }
  return out.join('\n')
}

const scaleVars = Object.entries(tokens.font.scale)
  .flatMap(([name, s]) => {
    const k = kebab(name)
    const rows = [
      `  --font-${k}-size: ${s.size}px;`,
      `  --font-${k}-line: ${s.lineHeight}px;`,
      `  --font-${k}-weight: ${s.weight};`,
    ]
    if (s.tracking) rows.push(`  --font-${k}-tracking: ${s.tracking}px;`)
    return rows
  })
  .join('\n')

const flat = (prefix, obj, unit = '') =>
  Object.entries(obj)
    .map(([k, v]) => `  --${prefix}-${kebab(k)}: ${typeof v === 'number' ? v + unit : v};`)
    .join('\n')

const css = `/* ────────────────────────────────────────────────────────────────
   Aurora — tokens de Nexus ERP
   GENERADO AUTOMATICAMENTE desde tokens.json. No editar a mano.
   Regenerar con: pnpm --filter @nexus/config build
   ──────────────────────────────────────────────────────────────── */

:root {
  color-scheme: dark light;

  /* Tipografia */
  --font-ui: ${tokens.font.family.ui};
  --font-numeric: ${tokens.font.family.numeric};
  --font-mono: ${tokens.font.family.mono};

${scaleVars}

  /* Espaciado */
${flat('space', tokens.space, 'px')}

  /* Radios */
${flat('radius', tokens.radius, 'px')}

  /* Sombras */
${flat('shadow', tokens.shadow)}

  /* Layout */
${flat('layout', tokens.layout, 'px')}

  /* Movimiento */
${flat('duration', tokens.motion.duration, 'ms')}
${flat('ease', tokens.motion.easing)}
}

/* ── Tema oscuro (por defecto) ────────────────────────────────── */
:root,
:root[data-theme='dark'] {
${colorVars('dark')}
}

/* ── Tema claro ───────────────────────────────────────────────── */
@media (prefers-color-scheme: light) {
  :root:not([data-theme='dark']) {
${colorVars('light')}
  }
}

:root[data-theme='light'] {
${colorVars('light')}
}

/* ── Accesibilidad ────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* El foco SIEMPRE es visible. Nunca outline:none sin reemplazo.
   Usa brand-bright, no brand: el blurple puro da 2.74:1 sobre el fondo
   oscuro y el anillo literalmente no se ve. */
:focus-visible {
  outline: 2px solid var(--color-brand-bright);
  outline-offset: 2px;
  box-shadow: var(--shadow-focus);
}

/* Los numeros se alinean en columnas. */
[data-numeric],
td[align='right'] {
  font-variant-numeric: tabular-nums;
}
`

await mkdir(join(DIR, 'dist'), { recursive: true })
await writeFile(join(DIR, 'dist', 'tokens.css'), css, 'utf8')
console.log('tokens.css generado desde tokens.json')
