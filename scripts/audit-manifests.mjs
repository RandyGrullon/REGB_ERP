#!/usr/bin/env node
/**
 * Puerta de catalogo — todo manifest de modules/ es valido y coherente.
 *
 * `defineModule()` valida el contrato al cargar, pero solo si alguien lo
 * carga. Con 93 modulos en el catalogo, un manifest roto puede quedarse
 * meses sin que nadie lo importe. Esto los carga todos, en cada build.
 *
 * Ademas comprueba lo que el contrato por si solo no puede ver:
 *  · que el precio corresponda a la categoria declarada (§6.3)
 *  · que las dependencias apunten a modulos que existen
 *  · que dos modulos no reclamen la misma ruta
 */
import { readdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const MODULES_DIR = join(ROOT, 'modules')

/** Matriz de §6.3. Un modulo debe cobrar lo que su categoria dice. */
const PRICING = {
  core: { install: [0, 0, 0], monthly: [0, 0, 0] },
  standard: { install: [150, 600, 1800], monthly: [19, 69, 190] },
  advanced: { install: [400, 1500, 4000], monthly: [45, 160, 420] },
  vertical: { install: [600, 2200, 6000], monthly: [59, 210, 550] },
  enterprise: { install: [null, null, 12000], monthly: [null, null, 900] },
}

const TIERS = ['pyme', 'mediano', 'grande']
const findings = []

let entries
try {
  entries = await readdir(MODULES_DIR, { withFileTypes: true })
} catch {
  console.log('audit:manifests OK — todavia no hay modulos.')
  process.exit(0)
}

const manifests = new Map()

for (const e of entries) {
  if (!e.isDirectory() || e.name.startsWith('_')) continue
  const file = join(MODULES_DIR, e.name, 'manifest.ts')
  try {
    await access(file)
  } catch {
    findings.push({ mod: e.name, msg: 'No tiene manifest.ts.' })
    continue
  }

  try {
    const mod = await import(pathToFileURL(resolve(file)).href)
    const m = mod.default
    if (!m?.id) {
      findings.push({ mod: e.name, msg: 'El manifest no exporta un modulo por defecto.' })
      continue
    }
    if (m.id !== e.name) {
      findings.push({ mod: e.name, msg: `El id "${m.id}" no coincide con la carpeta "${e.name}".` })
    }
    manifests.set(m.id, m)
  } catch (err) {
    findings.push({ mod: e.name, msg: `No carga: ${err.message.split('\n')[0]}` })
  }
}

// ── Precio coherente con la categoria ──────────────────────────────────
for (const [id, m] of manifests) {
  const esperado = PRICING[m.category]
  if (!esperado) continue

  TIERS.forEach((tier, i) => {
    for (const campo of ['install', 'monthly']) {
      const ref = esperado[campo][i]
      if (ref === null) continue
      const real = m.pricing[campo][tier]
      if (real !== ref) {
        findings.push({
          mod: id,
          msg: `Precio ${campo}/${tier} = ${real}, pero la categoria "${m.category}" define ${ref} (§6.3). Si el precio es a proposito, actualiza la matriz del documento maestro.`,
        })
      }
    }
  })
}

// ── Dependencias que existen ───────────────────────────────────────────
// Se comprueba solo contra lo construido: `requires` a un modulo del
// catalogo que aun no existe es normal durante el desarrollo, pero un
// `requires` a un id que NO esta en el catalogo es una errata.
const CATALOGO = new Set([
  'auth',
  'users',
  'rbac',
  'orgs',
  'branches',
  'dashboard',
  'search',
  'notifications',
  'audit',
  'settings',
  'files',
  'tour',
  'marketplace',
  'imports',
  'backup',
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
  'invoice-capture',
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
  'chat',
])

for (const [id, m] of manifests) {
  for (const campo of ['requires', 'recommends', 'conflicts']) {
    for (const dep of m[campo] ?? []) {
      if (!CATALOGO.has(dep)) {
        findings.push({ mod: id, msg: `${campo} apunta a "${dep}", que no esta en el catalogo.` })
      }
    }
  }
}

// ── Rutas sin colision ─────────────────────────────────────────────────
const rutas = new Map()
for (const [id, m] of manifests) {
  for (const r of m.routes ?? []) {
    const duenio = rutas.get(r.path)
    if (duenio) {
      findings.push({ mod: id, msg: `La ruta "${r.path}" ya la reclama "${duenio}".` })
    } else {
      rutas.set(r.path, id)
    }
  }
}

// ── Reporte ────────────────────────────────────────────────────────────
if (findings.length === 0) {
  console.log(
    `audit:manifests OK — ${manifests.size} modulo(s) validos, ${rutas.size} rutas sin colision.`,
  )
  process.exit(0)
}

console.error(`\naudit:manifests ${findings.length} PROBLEMA(S)\n`)
for (const f of findings) {
  console.error(`  [${f.mod}] ${f.msg}`)
}
console.error('')
process.exit(1)
