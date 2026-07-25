#!/usr/bin/env node
/** Aplica supabase/seed/demo.sql. Idempotente. */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const DIR = dirname(fileURLToPath(import.meta.url))
const url = process.env.DATABASE_URL

if (!url) {
  console.error('Falta DATABASE_URL.')
  process.exit(1)
}

const sql = postgres(url, { max: 1, onnotice: () => {} })

try {
  const body = await readFile(join(DIR, '..', 'seed', 'demo.sql'), 'utf8')
  await sql.unsafe(body)

  const tenants = await sql`
    select t.slug, t.tier, count(tm.module_id) as modulos
    from nexus.tenants t
    left join nexus.tenant_modules tm on tm.tenant_id = t.id
    group by t.slug, t.tier order by t.slug`

  console.log('Seed aplicado:')
  for (const t of tenants) {
    console.log(`  ${t.slug.padEnd(24)} ${t.tier.padEnd(8)} ${t.modulos} modulos`)
  }
} catch (err) {
  console.error('Fallo el seed:', err.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
