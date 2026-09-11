#!/usr/bin/env node
/**
 * Respaldo de la base, comprimido y fechado.
 *
 * Existe porque un cliente que pierde datos no se queda, y hasta hoy el
 * proyecto no tenia forma de recuperar nada. Es lo unico de la lista de
 * pendientes que puede terminar el negocio de un golpe.
 *
 * Usa `pg_dump` y no un volcado escrito a mano: reproducir en JavaScript
 * el orden de dependencias, las secuencias, los triggers y las politicas
 * de RLS es exactamente el tipo de codigo que parece funcionar hasta el
 * dia que hay que restaurar de verdad. La herramienta oficial ya lo
 * resuelve y se mantiene sola.
 *
 * Si `pg_dump` no esta en el PATH -que es lo normal en Windows sin
 * Postgres instalado- se usa el que vive DENTRO del contenedor de
 * Docker con `--docker`. Asi no hay que instalar nada para respaldar la
 * base local.
 *
 * Formato `custom` (-Fc): ya viene comprimido, permite restaurar tablas
 * sueltas y es el que `pg_restore` entiende. Un .sql plano se ve mas
 * amigable y es peor en todo lo demas.
 *
 * Uso:
 *   node scripts/respaldo.mjs --docker regb-test-db
 *   DATABASE_URL=postgresql://... node scripts/respaldo.mjs
 *
 * Opciones:
 *   --docker <contenedor>  usa el pg_dump de ese contenedor
 *   --destino <carpeta>    donde guardar (por defecto ./respaldos)
 *   --conservar <n>        cuantos respaldos guardar (por defecto 14)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function opcion(nombre, pordefecto = null) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? pordefecto : process.argv[i + 1]
}

const contenedor = opcion('docker')
const destino = opcion('destino', join(ROOT, 'respaldos'))
const conservar = Number(opcion('conservar', '14'))
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'

/**
 * La URL tal como la ve el proceso que corre pg_dump.
 *
 * Dentro del contenedor, `localhost` es el propio Postgres y el puerto
 * es el 5432 interno, no el 55432 publicado hacia afuera. Sin esta
 * traduccion el respaldo falla con un "connection refused" que no dice
 * nada.
 */
function urlParaDocker(u) {
  return u.replace(/@[^:/]+:\d+\//, '@localhost:5432/')
}

function ejecutar(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} salio con codigo ${code}`))))
  })
}

const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const nombre = `regb-${sello}.dump`
const rutaLocal = join(destino, nombre)

mkdirSync(destino, { recursive: true })

console.log(`Respaldando a ${rutaLocal}`)

try {
  if (contenedor) {
    // Se vuelca DENTRO del contenedor y despues se copia afuera. Mandar
    // el binario por stdout a traves de docker corrompe el archivo en
    // Windows: la consola traduce saltos de linea y un .dump no es texto.
    const tmp = `/tmp/${nombre}`
    await ejecutar('docker', [
      'exec', contenedor,
      'pg_dump', '-Fc', '--no-owner', '--no-acl', '-f', tmp, urlParaDocker(url),
    ])
    await ejecutar('docker', ['cp', `${contenedor}:${tmp}`, rutaLocal])
    await ejecutar('docker', ['exec', contenedor, 'rm', '-f', tmp])
  } else {
    await ejecutar('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', rutaLocal, url])
  }
} catch (e) {
  console.error(`\nNo se pudo respaldar: ${e.message}`)
  if (!contenedor) {
    console.error(
      'Si `pg_dump` no esta instalado, usa el del contenedor:\n' +
        '  node scripts/respaldo.mjs --docker regb-test-db',
    )
  }
  process.exit(1)
}

if (!existsSync(rutaLocal) || statSync(rutaLocal).size === 0) {
  console.error('El respaldo salio vacio. Se aborta sin borrar los anteriores.')
  process.exit(1)
}

const tam = (statSync(rutaLocal).size / 1024 / 1024).toFixed(2)
console.log(`Listo: ${nombre} (${tam} MB)`)

// ── Rotacion ────────────────────────────────────────────────────────────
//  Se borran los mas viejos DESPUES de confirmar que el nuevo existe y
//  no esta vacio. Al reves -limpiar primero- un fallo de pg_dump dejaria
//  al negocio sin respaldo viejo y sin respaldo nuevo.
const previos = readdirSync(destino)
  .filter((f) => f.startsWith('regb-') && f.endsWith('.dump'))
  .sort()
  .reverse()

for (const viejo of previos.slice(conservar)) {
  unlinkSync(join(destino, viejo))
  console.log(`Rotado (borrado): ${viejo}`)
}

console.log(
  `\nUn respaldo que nunca se restauro no es un respaldo. Verificalo con:\n` +
    `  node scripts/restaurar.mjs ${rutaLocal} --docker ${contenedor ?? '<contenedor>'} --verificar`,
)
