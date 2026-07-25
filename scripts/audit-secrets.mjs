#!/usr/bin/env node
/**
 * Puerta F0 — ningun secreto ni `service_role` puede vivir en codigo de cliente.
 *
 * `service_role` bypasea RLS por completo. Si llega al bundle de una app,
 * cualquier usuario puede leer los datos de todos los tenants.
 * Solo puede aparecer en supabase/functions/ (Edge Functions, lado servidor).
 *
 * Ver documento maestro §10 y la skill /rls-audit (Fase 3).
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()

/** Rutas donde SI es legitimo usar service_role. */
const ALLOWED = [join('supabase', 'functions'), join('scripts', 'audit-secrets.mjs')]

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'dist',
  '.next',
  'graphify-out',
  'out',
])
const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro)$/

const PATTERNS = [
  {
    id: 'service_role',
    re: /\bservice_role\b|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/,
    msg: 'service_role bypasea RLS. Solo puede vivir en supabase/functions/.',
  },
  {
    id: 'jwt-hardcoded',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
    msg: 'JWT hardcodeado en el codigo.',
  },
  {
    id: 'private-key',
    re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    msg: 'Clave privada embebida en el repositorio.',
  },
  {
    id: 'stripe-live',
    re: /\bsk_live_[A-Za-z0-9]{10,}/,
    msg: 'Clave secreta de Stripe en produccion.',
  },
  {
    id: 'generic-secret',
    re: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{24,}['"]/i,
    msg: 'Posible secreto hardcodeado.',
  },
]

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.claude') continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (SCAN_EXT.test(entry.name)) yield full
  }
}

const findings = []

for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file)
  if (
    ALLOWED.some(
      (a) => rel.startsWith(a) || rel.split(sep).join('/').startsWith(a.split(sep).join('/')),
    )
  ) {
    continue
  }
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
  lines.forEach((line, i) => {
    if (/eslint-disable.*audit-secrets|audit-secrets:ignore/.test(line)) return
    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        findings.push({
          file: rel,
          line: i + 1,
          id: p.id,
          msg: p.msg,
          text: line.trim().slice(0, 110),
        })
      }
    }
  })
}

if (findings.length === 0) {
  console.log('audit:secrets  OK — ningun secreto ni service_role en codigo de cliente.')
  process.exit(0)
}

console.error(`\naudit:secrets  ${findings.length} HALLAZGO(S) CRITICO(S)\n`)
for (const f of findings) {
  console.error(`  [${f.id}] ${f.file}:${f.line}`)
  console.error(`     ${f.msg}`)
  console.error(`     > ${f.text}\n`)
}
console.error('La puerta F0 no pasa. Ver documento maestro §10.\n')
process.exit(1)
