#!/usr/bin/env node
/**
 * Aplica las migraciones que FALTAN, llevando registro de cuales ya
 * corrieron.
 *
 * ── Por que se reescribio (2026-09-11) ────────────────────────────────
 *
 * La version anterior aplicaba `supabase/migrations/*.sql` en orden
 * DESDE CERO, sin registro. Eso funciona contra una base recien creada
 * -que es como corre el `gate:f0` local- pero contra una base que ya
 * tiene migraciones aplicadas revienta en la primera ("el esquema ya
 * existe") y aborta. Con el Supabase real 60 migraciones por detras, no
 * habia forma de ponerlo al dia sin borrarlo.
 *
 * Ahora hay un libro: `regb.migraciones_aplicadas`. Se aplica solo lo
 * nuevo, cada una en su transaccion, y se anota.
 *
 * ── La deriva, que es el peligro de verdad ────────────────────────────
 *
 * Se guarda tambien el hash del archivo. Si una migracion YA aplicada
 * cambia despues en el repo, este script lo grita en vez de seguir: esa
 * base y este repo dejaron de ser lo mismo, y lo peor que puede pasar es
 * que nadie se entere hasta que una consulta falle en produccion.
 *
 * ── Uso ───────────────────────────────────────────────────────────────
 *
 *   DATABASE_URL=postgresql://... node scripts/aplicar-migraciones.mjs
 *   ... --listar                 solo dice que falta, no toca nada
 *   ... --marcar-hasta 0040      da por aplicadas las <= 0040 sin correrlas
 *
 * `--marcar-hasta` existe para una base que YA tiene migraciones puestas
 * a mano y todavia no tiene libro. Es la unica forma de adoptar una base
 * existente sin borrarla. Usalo una vez y con el numero correcto: marcar
 * de mas se salta migraciones que nunca corrieron.
 */
import postgres from 'postgres'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(ROOT, 'supabase', 'migrations')

function opcion(nombre) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? null : process.argv[i + 1]
}
const soloListar = process.argv.includes('--listar')
const marcarHasta = opcion('marcar-hasta')

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en el entorno.')
  process.exit(1)
}

const archivos = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const hashDe = (f) => createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex').slice(0, 16)

// 'prefer' sirve para los dos casos: Supabase exige TLS y lo negocia
// solo; el Postgres local de pruebas no lo tiene y cae a conexion simple.
// `onnotice` callado: Postgres avisa de cada "ya existe, se omite" y esos
// avisos tapan el unico mensaje que importa, que es el fallo real.
const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'prefer',
  connect_timeout: 15,
  onnotice: () => {},
})

try {
  // El libro se crea solo. Va en `regb` -el esquema del proveedor- y no en
  // `public`, que es del tenant.
  await sql`create schema if not exists regb`
  await sql`
    create table if not exists regb.migraciones_aplicadas (
      nombre      text primary key,
      hash        text not null,
      aplicada_en timestamptz not null default now()
    )`

  const previas = await sql`select nombre, hash from regb.migraciones_aplicadas`
  const yaAplicadas = new Map(previas.map((r) => [r.nombre, r.hash]))

  // ── Adoptar una base que ya tenia migraciones puestas a mano ──────────
  if (marcarHasta) {
    const aMarcar = archivos.filter((f) => f.slice(0, 4) <= marcarHasta && !yaAplicadas.has(f))
    for (const f of aMarcar) {
      await sql`
        insert into regb.migraciones_aplicadas (nombre, hash) values (${f}, ${hashDe(f)})
        on conflict (nombre) do nothing`
    }
    console.log(`Marcadas como aplicadas ${aMarcar.length} migracion(es) hasta ${marcarHasta}.`)
    console.log('NO se ejecutaron: se dieron por puestas. Verifica que de verdad lo esten.')
    aMarcar.forEach((f) => console.log(`  · ${f}`))
    await sql.end()
    process.exit(0)
  }

  // ── Deriva: algo aplicado que cambio despues en el repo ───────────────
  const derivadas = archivos.filter((f) => yaAplicadas.has(f) && yaAplicadas.get(f) !== hashDe(f))
  if (derivadas.length > 0) {
    console.error('\nDERIVA: estas migraciones ya se aplicaron y despues CAMBIARON en el repo:')
    derivadas.forEach((f) => console.error(`  · ${f}`))
    console.error(
      '\nLa base y el repo dejaron de ser lo mismo. Una migracion aplicada no se\n' +
        'edita: se escribe otra nueva que corrija. Se aborta sin tocar nada.',
    )
    await sql.end()
    process.exit(1)
  }

  const pendientes = archivos.filter((f) => !yaAplicadas.has(f))

  console.log(`${archivos.length} en el repo · ${yaAplicadas.size} aplicadas · ${pendientes.length} pendientes`)

  if (pendientes.length === 0) {
    console.log('Nada que hacer: la base esta al dia.')
    await sql.end()
    process.exit(0)
  }

  if (soloListar) {
    console.log('\nPendientes:')
    pendientes.forEach((f) => console.log(`  · ${f}`))
    await sql.end()
    process.exit(0)
  }

  for (const f of pendientes) {
    process.stdout.write(`${f} ... `)
    try {
      // Cada una en su transaccion: si la 0095 falla, las 0090-0094 se
      // quedan aplicadas y anotadas. Reintentar sigue desde donde quedo
      // en vez de repetir lo que ya funciono.
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(DIR, f), 'utf8'))
        await tx`insert into regb.migraciones_aplicadas (nombre, hash) values (${f}, ${hashDe(f)})`
      })
      console.log('OK')
    } catch (e) {
      console.log('FALLO')
      console.error(`\n${e.message}\n`)
      console.error(`Se aplicaron las anteriores y quedaron anotadas. Arregla ${f} y vuelve a correr.`)
      await sql.end()
      process.exit(1)
    }
  }

  console.log(`\n${pendientes.length} migracion(es) aplicadas. La base esta al dia.`)
} finally {
  await sql.end()
}
