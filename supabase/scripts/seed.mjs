#!/usr/bin/env node
/**
 * Aplica supabase/seed/demo.sql y despues cada `demo-*.sql` de la misma
 * carpeta, en orden alfabetico. Idempotente.
 *
 * Los `demo-<area>.sql` existen para que la demo de cada area (ventas,
 * finanzas, personas...) crezca en su propio archivo: con todo en uno
 * solo, dos personas que llenan pantallas vacias a la vez chocan en el
 * mismo archivo de 3,000 lineas.
 */
import { readFile, readdir } from 'node:fs/promises'
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
  const carpeta = join(DIR, '..', 'seed')
  const extras = (await readdir(carpeta)).filter((f) => /^demo-.+\.sql$/.test(f)).sort()
  for (const archivo of ['demo.sql', ...extras]) {
    await sql.unsafe(await readFile(join(carpeta, archivo), 'utf8'))
    if (archivo !== 'demo.sql') console.log(`  + ${archivo}`)
  }

  const tenants = await sql`
    select t.slug, t.tier, count(tm.module_id) as modulos
    from regb.tenants t
    left join regb.tenant_modules tm on tm.tenant_id = t.id
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
