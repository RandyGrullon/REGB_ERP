#!/usr/bin/env node
/**
 * Aplica las migraciones en orden contra DATABASE_URL.
 *
 * Se usa en CI (Postgres limpio) y en local. Para desarrollo con Supabase
 * completo (auth, storage, realtime) usa `pnpm db:reset`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const url = process.env.DATABASE_URL

if (!url) {
  console.error('Falta DATABASE_URL.')
  console.error('  ejemplo: postgresql://postgres:postgres@localhost:5432/nexus_test')
  process.exit(1)
}

const sql = postgres(url, { max: 1, onnotice: () => {} })

try {
  await sql`create table if not exists public.schema_migrations (
    version    text primary key,
    applied_at timestamptz not null default now()
  )`

  const applied = new Set(
    (await sql`select version from public.schema_migrations`).map((r) => r.version),
  )

  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort()
  let count = 0

  for (const file of files) {
    const version = file.replace(/\.sql$/, '')
    if (applied.has(version)) {
      console.log(`  = ${version} (ya aplicada)`)
      continue
    }
    const body = await readFile(join(DIR, file), 'utf8')
    process.stdout.write(`  → ${version} ... `)
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`insert into public.schema_migrations (version) values (${version})`
    })
    console.log('OK')
    count++
  }

  console.log(
    count === 0 ? '\nSin migraciones pendientes.' : `\n${count} migracion(es) aplicada(s).`,
  )
} catch (err) {
  console.error('\nFallo la migracion:', err.message)
  process.exitCode = 1
} finally {
  await sql.end()
}
