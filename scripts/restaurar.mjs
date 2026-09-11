#!/usr/bin/env node
/**
 * Restaura un respaldo — y, con `--verificar`, DEMUESTRA que sirve.
 *
 * Un respaldo que nunca se restauro no es un respaldo: es un archivo. La
 * unica forma de saber que la copia de anoche te salva es levantarla y
 * contar lo que trae. Eso es lo que hace `--verificar`: restaura en una
 * base desechable, compara el conteo de las tablas que de verdad
 * importan contra la base viva, y borra la desechable al terminar.
 *
 * Restaurar VERIFICANDO no toca la base real. Restaurar de verdad
 * (`--sobre <base>`) si, y por eso hay que escribir el nombre completo:
 * no hay opcion que lo adivine.
 *
 * Uso:
 *   node scripts/restaurar.mjs respaldos/regb-....dump --docker regb-test-db --verificar
 *   node scripts/restaurar.mjs respaldos/regb-....dump --docker regb-test-db --sobre regb_test
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import postgres from 'postgres'

function opcion(nombre, pordefecto = null) {
  const i = process.argv.indexOf(`--${nombre}`)
  return i === -1 ? pordefecto : process.argv[i + 1]
}
const bandera = (n) => process.argv.includes(`--${n}`)

const archivo = process.argv[2]
const contenedor = opcion('docker')
const sobre = opcion('sobre')
const verificar = bandera('verificar')
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'

if (!archivo || archivo.startsWith('--')) {
  console.error('Falta el archivo de respaldo.\n  node scripts/restaurar.mjs <archivo.dump> --docker <contenedor> --verificar')
  process.exit(1)
}
if (!existsSync(archivo) || statSync(archivo).size === 0) {
  console.error(`El archivo ${archivo} no existe o esta vacio.`)
  process.exit(1)
}
if (!verificar && !sobre) {
  console.error(
    'Di que hacer:\n' +
      '  --verificar          restaura en una base desechable y compara (no toca nada tuyo)\n' +
      '  --sobre <base>       restaura DE VERDAD sobre esa base (destructivo)',
  )
  process.exit(1)
}
if (!contenedor) {
  console.error('Por ahora solo se restaura via --docker <contenedor>.')
  process.exit(1)
}

function ejecutar(cmd, args, { silencioso = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', silencioso ? 'ignore' : 'inherit', silencioso ? 'ignore' : 'inherit'] })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} salio con codigo ${code}`))))
  })
}

const admin = url.replace(/\/[^/]+$/, '/postgres')
const baseViva = url.split('/').pop()
const destino = verificar ? `verif_${Date.now()}` : sobre
const dentro = (base) => url.replace(/@[^:/]+:\d+\//, '@localhost:5432/').replace(/\/[^/]+$/, `/${base}`)

/**
 * Las tablas que hacen creible una restauracion.
 *
 * No se cuenta "todas las tablas" a proposito: lo que le importa a un
 * negocio es que esten las VENTAS, el dinero y los comprobantes. Si una
 * tabla de configuracion viene distinta se nota poco; si falta un ticket
 * cobrado, alguien perdio plata.
 */
const TABLAS = [
  'public.pos_sales',
  'public.pos_sale_lines',
  'public.pos_payments',
  'public.customer_invoices',
  'public.supplier_invoices',
  'public.inventory_movements',
  'public.products',
  'public.customers',
  'regb.tenants',
]

async function contar(sql) {
  const filas = {}
  for (const t of TABLAS) {
    try {
      const [r] = await sql.unsafe(`select count(*)::int as n from ${t}`)
      filas[t] = r.n
    } catch {
      filas[t] = null // la tabla no existe en esa base
    }
  }
  return filas
}

const admSql = postgres(admin, { max: 1, onnotice: () => {} })

try {
  console.log(`Restaurando ${basename(archivo)} en "${destino}"${verificar ? ' (base desechable)' : ''}`)

  // El dump vive afuera; pg_restore corre adentro. Se copia primero.
  const tmp = `/tmp/${basename(archivo)}`
  await ejecutar('docker', ['cp', archivo, `${contenedor}:${tmp}`])

  if (verificar) {
    await admSql.unsafe(`create database "${destino}"`)
  }

  // --clean --if-exists deja la base como la dejo el respaldo, sin restos
  // de lo que hubiera antes. Sin eso, restaurar "encima" mezcla dos
  // momentos distintos y el resultado no es ninguno de los dos.
  // pg_restore avisa de objetos que ya existian; eso no es un fallo.
  await ejecutar('docker', [
    'exec', contenedor,
    'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-acl',
    '-d', dentro(destino), tmp,
  ]).catch((e) => {
    console.warn(`pg_restore reporto avisos (${e.message}); se sigue y se verifica el resultado.`)
  })

  await ejecutar('docker', ['exec', contenedor, 'rm', '-f', tmp], { silencioso: true })

  if (!verificar) {
    console.log(`\nRestaurado sobre "${destino}".`)
    process.exit(0)
  }

  // ── La verificacion ───────────────────────────────────────────────────
  const sqlRestaurada = postgres(url.replace(/\/[^/]+$/, `/${destino}`), { max: 1, onnotice: () => {} })
  const sqlViva = postgres(url, { max: 1, onnotice: () => {} })

  const [rest, viva] = await Promise.all([contar(sqlRestaurada), contar(sqlViva)])
  await Promise.all([sqlRestaurada.end(), sqlViva.end()])

  let fallos = 0
  let vacias = 0
  console.log(`\n${'tabla'.padEnd(30)} ${'viva'.padStart(8)} ${'restaurada'.padStart(11)}`)
  console.log('-'.repeat(52))
  for (const t of TABLAS) {
    const v = viva[t]
    const r = rest[t]
    const ok = v === r
    if (!ok) fallos++
    if (r === null) vacias++
    console.log(
      `${t.padEnd(30)} ${String(v ?? '—').padStart(8)} ${String(r ?? 'NO EXISTE').padStart(11)}  ${ok ? 'ok' : '<-- DIFIERE'}`,
    )
  }

  await admSql.unsafe(`drop database "${destino}" with (force)`)

  if (vacias === TABLAS.length) {
    console.error('\nLa base restaurada no tiene NINGUNA de las tablas: el respaldo no sirve.')
    process.exit(1)
  }
  if (fallos > 0) {
    console.error(
      `\n${fallos} tabla(s) no coinciden.\n` +
        'Si el respaldo es de hace rato, una diferencia en tablas que siguen\n' +
        'moviendose es esperable. Una diferencia en una tabla quieta, no.',
    )
    process.exit(1)
  }

  console.log(`\nRespaldo verificado: la base "${baseViva}" se puede reconstruir de este archivo.`)
} catch (e) {
  console.error(`\nFallo: ${e.message}`)
  if (verificar) {
    await admSql.unsafe(`drop database if exists "${destino}" with (force)`).catch(() => {})
  }
  process.exit(1)
} finally {
  await admSql.end()
}
