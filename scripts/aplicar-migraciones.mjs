#!/usr/bin/env node
/**
 * Aplica supabase/migrations/*.sql en orden, desde cero, contra
 * `DATABASE_URL`. No hay `down`: la garantia es que arranca limpia, la
 * misma que se ejerce en cada `gate:f0` contra el Postgres local.
 *
 * Existe porque ni `psql` ni el CLI de `supabase` estan garantizados en
 * todos los entornos donde esto se ejecuta — el driver `postgres` (ya
 * dependencia del repo) hace lo mismo con `sql.file()`.
 *
 * Corta en el primer archivo que falle: una migracion a medias es peor
 * que ninguna, porque parece que funciono.
 *
 * Uso: DATABASE_URL=postgresql://... node scripts/aplicar-migraciones.mjs
 */
import postgres from 'postgres'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(ROOT, 'supabase', 'migrations')

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en el entorno.')
  process.exit(1)
}

const archivos = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

// 'prefer' funciona para los dos casos: Supabase exige TLS y lo negocia
// solo; el Postgres local de pruebas no lo tiene configurado y cae a
// conexion simple sin fallar.
const sql = postgres(process.env.DATABASE_URL, { ssl: 'prefer', connect_timeout: 15 })

for (const f of archivos) {
  process.stdout.write(`${f} ... `)
  try {
    await sql.file(join(DIR, f))
    console.log('OK')
  } catch (e) {
    console.log('FALLO')
    console.error(e.message)
    await sql.end()
    process.exit(1)
  }
}

console.log(`\n${archivos.length} migraciones aplicadas.`)
await sql.end()
