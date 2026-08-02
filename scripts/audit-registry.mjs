#!/usr/bin/env node
/**
 * Puerta F1 — el core no conoce los modulos.
 *
 * Documento maestro §2.2: "Cero `if (moduleX)` en el core."
 * Si el core ramifica por id de modulo, el registry no es realmente dinamico
 * y cada uno de los 92 modulos costara el triple.
 *
 * Esta auditoria busca condicionales que mencionen ids de modulo concretos
 * fuera de packages/module-registry y de los propios modulos.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

/** Aqui SI es legitimo conocer ids de modulo. */
const ALLOWED_PREFIXES = [
  join('packages', 'module-registry'),
  join('modules'),
  join('scripts'),
  join('supabase'),
  join('docs'),
]

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'dist',
  '.next',
  'graphify-out',
  'out',
])
const SCAN_EXT = /\.(ts|tsx)$/

/** Ids del catalogo de §5 que no deben aparecer en condicionales del core. */
const MODULE_IDS = [
  'accounting',
  'ar',
  'ap',
  'treasury',
  'bank-rec',
  'fixed-assets',
  'budgets',
  'cost-centers',
  'taxes',
  'e-invoice',
  'multicurrency',
  'payments',
  'consolidation',
  'crm',
  'pipeline',
  'quotes',
  'sales-orders',
  'contracts',
  'commissions',
  'pos',
  'ecommerce',
  'marketing',
  'loyalty',
  'customer-portal',
  'helpdesk',
  'price-lists',
  'suppliers',
  'requisitions',
  'rfq',
  'purchase-orders',
  'receipts',
  'products',
  'inventory',
  'lots-serials',
  'transfers',
  'stock-counts',
  'barcode',
  'logistics',
  'fleet',
  'bom',
  'manufacturing',
  'mrp',
  'quality',
  'maintenance',
  'shopfloor',
  'employees',
  'payroll',
  'attendance',
  'time-off',
  'recruiting',
  'performance',
  'training',
  'expenses',
  'benefits',
  'hr-portal',
  'projects',
  'timesheets',
  'project-costing',
  'field-service',
  'resources',
  'restaurant',
  'clinic',
  'hotel',
  'workshop',
  'real-estate',
  'education',
  'gym',
  'pharmacy',
  'agro',
  'construction',
  'laundry',
  'bi',
  'automations',
  'api-webhooks',
  'ai-copilot',
  'e-sign',
]

const idAlternation = MODULE_IDS.map((id) => id.replace(/-/g, '[-_]')).join('|')

/** `if (... 'inventory' ...)`, `switch`, ternarios y comparaciones directas. */
const CONDITIONAL_RE = new RegExp(
  `(?:if\\s*\\(|switch\\s*\\(|\\?\\s*|===|!==|case\\s+)[^\\n]{0,60}['"\`](${idAlternation})['"\`]`,
  'i',
)

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (SCAN_EXT.test(entry.name)) yield full
  }
}

/**
 * Dependencias DECLARADAS de cada modulo, leidas de su manifest.
 *
 * Un modulo puede referirse a otro si lo declara en `requires` — asi el
 * acoplamiento es dato visible en el manifest, no una cadena escondida en
 * el codigo. Lo que se persigue es el acoplamiento SILENCIOSO.
 *
 * Se leen como texto a proposito: este script corre antes de compilar y no
 * puede cargar TypeScript.
 */
async function leerManifests() {
  const porRuta = new Map() // primer segmento de ruta → { id, requires }
  let dirs = []
  try {
    dirs = await readdir(join(ROOT, 'modules'), { withFileTypes: true })
  } catch {
    return porRuta
  }

  for (const d of dirs) {
    if (!d.isDirectory()) continue
    let src
    try {
      src = await readFile(join(ROOT, 'modules', d.name, 'manifest.ts'), 'utf8')
    } catch {
      continue
    }
    const id = /\bid:\s*'([^']+)'/.exec(src)?.[1]
    if (!id) continue

    const requiresRaw = /\brequires:\s*\[([^\]]*)\]/s.exec(src)?.[1] ?? ''
    const requires = [...requiresRaw.matchAll(/'([^']+)'/g)].map((m) => m[1])

    for (const m of src.matchAll(/path:\s*'\/([^'/]*)/g)) {
      const seg = m[1]
      if (seg) porRuta.set(seg, { id, requires })
    }
  }
  return porRuta
}

const MODULOS_POR_RUTA = await leerManifests()

/**
 * ¿El archivo pertenece a un modulo que declara ese id como dependencia?
 * `apps/web/src/app/importar/actions.ts` pertenece a `imports`, que declara
 * `requires: ['products']`; referirse a `products` ahi es legitimo.
 */
function referenciaDeclarada(rel, id) {
  const m = /^apps[\\/][^\\/]+[\\/]src[\\/]app[\\/]([^\\/]+)/.exec(rel)
  if (!m) return false
  const duenio = MODULOS_POR_RUTA.get(m[1])
  if (!duenio) return false
  return duenio.id === id || duenio.requires.includes(id)
}

const findings = []

for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file)
  if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue

  const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
  lines.forEach((line, i) => {
    if (/registry:allow/.test(line)) return
    const m = CONDITIONAL_RE.exec(line)
    if (!m) return
    if (referenciaDeclarada(rel, m[1])) return
    findings.push({ file: rel, line: i + 1, id: m[1], text: line.trim().slice(0, 110) })
  })
}

if (findings.length === 0) {
  console.log('audit:registry OK — el core no ramifica por id de modulo.')
  process.exit(0)
}

console.error(
  `\naudit:registry ${findings.length} VIOLACION(ES) DEL PRINCIPIO "el core no conoce los modulos"\n`,
)
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  → condicional sobre el modulo "${f.id}"`)
  console.error(`     > ${f.text}\n`)
}
console.error(
  'El descubrimiento debe venir de regb.tenant_modules via el registry. Ver §2.2 y §4.\n' +
    'Si es la UI de un modulo refiriendose a otro del que DEPENDE, declaralo en\n' +
    '`requires` de su manifest: asi el acoplamiento queda visible en el catalogo.\n',
)
process.exit(1)
