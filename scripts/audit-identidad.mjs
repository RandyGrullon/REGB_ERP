#!/usr/bin/env node
/**
 * Puerta F0 — lo que fija la identidad de un cliente solo vive en SU
 * transaccion.
 *
 * ── Por que ───────────────────────────────────────────────────────────
 *
 * En produccion la app habla con Supabase a traves de Supavisor en modo
 * transaccion: la MISMA conexion fisica atiende, una tras otra, a
 * peticiones de clientes distintos. `asUser()` (apps/web/src/lib/db.ts)
 * es seguro ahi porque todo lo que fija identidad es local a la
 * transaccion:
 *
 *   select set_config('request.jwt.claims', ..., true)   ← true = local
 *   set local role authenticated
 *
 * Basta un `set_config(..., false)` o un `set role` sin `local` para que
 * los claims de un tenant se queden pegados a la conexion y la siguiente
 * peticion -de OTRO cliente- los herede. RLS dejaria de aislar sin que
 * ninguna prueba lo notara: las pruebas van directo a Postgres, no pasan
 * por el pooler.
 *
 * Esto no se puede probar con una consulta; se puede impedir leyendo el
 * codigo. Es lo que hace este script. Ver docs/defi-v1.md §4.3.
 *
 *   node scripts/audit-identidad.mjs
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** Codigo que corre contra la base compartida en produccion. */
const RAICES = ['apps', 'packages', join('supabase', 'functions')]

const SKIP_DIRS = new Set(['node_modules', '.git', '.turbo', 'dist', '.next', 'out'])
const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
/** Las pruebas abren conexiones propias, fuera del pooler. */
const ES_PRUEBA = /\.test\.(ts|tsx|js|mjs)$|[\\/]test[\\/]/

const PATRONES = [
  {
    id: 'set_config-de-sesion',
    re: /set_config\s*\([^;]*?,\s*'?false'?\s*\)/i,
    msg: "set_config(..., false) fija el valor para TODA la conexion. Usa `true` (local a la transaccion).",
  },
  {
    id: 'set-role-de-sesion',
    // `set local role` es el correcto; `set role_id = ...` de un UPDATE no
    // es un cambio de rol (ahi no hay espacio despues de `role`).
    re: /\bset\s+(session\s+)?role\s+(?!=)/i,
    msg: 'SET ROLE sin LOCAL deja el rol pegado a la conexion. Usa `set local role`.',
  },
  {
    id: 'reset-role',
    re: /\breset\s+role\b/i,
    msg: 'RESET ROLE es de sesion: con `set local role` no hace falta.',
  },
]

async function* recorrer(dir) {
  let entradas
  try {
    entradas = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entradas) {
    if (SKIP_DIRS.has(e.name)) continue
    const ruta = join(dir, e.name)
    if (e.isDirectory()) yield* recorrer(ruta)
    else if (SCAN_EXT.test(e.name)) yield ruta
  }
}

const hallazgos = []
let revisados = 0

for (const raiz of RAICES) {
  for await (const archivo of recorrer(join(ROOT, raiz))) {
    const rel = relative(ROOT, archivo)
    if (ES_PRUEBA.test(rel)) continue
    revisados++
    const lineas = (await readFile(archivo, 'utf8')).split(/\r?\n/)
    lineas.forEach((linea, i) => {
      for (const p of PATRONES) {
        if (p.re.test(linea)) hallazgos.push({ rel, n: i + 1, p, linea: linea.trim() })
      }
    })
  }
}

if (hallazgos.length > 0) {
  console.error(`✗ audit:identidad — ${hallazgos.length} hallazgo(s):\n`)
  for (const h of hallazgos) {
    console.error(`  ${h.rel}:${h.n}  [${h.p.id}]`)
    console.error(`    ${h.linea}`)
    console.error(`    → ${h.p.msg}\n`)
  }
  process.exit(1)
}

console.log(`✓ audit:identidad — ${revisados} archivos: la identidad solo se fija dentro de la transaccion.`)
