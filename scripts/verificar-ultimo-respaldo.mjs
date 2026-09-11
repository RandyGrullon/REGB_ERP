#!/usr/bin/env node
/**
 * Toma el respaldo mas reciente y lo verifica.
 *
 * Existe para que "comprobar que los respaldos sirven" sea un comando de
 * una linea y no un procedimiento que alguien tiene que recordar. Lo que
 * no es facil de correr no se corre, y un respaldo sin verificar es un
 * archivo con nombre bonito.
 *
 * Uso: pnpm db:verificar-respaldo [--docker <contenedor>]
 */
import { spawn } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIR = join(ROOT, 'respaldos')

const i = process.argv.indexOf('--docker')
const contenedor = i === -1 ? 'regb-test-db' : process.argv[i + 1]

if (!existsSync(DIR)) {
  console.error('No hay carpeta de respaldos todavia. Corre primero: pnpm db:respaldar')
  process.exit(1)
}

const ultimo = readdirSync(DIR)
  .filter((f) => f.startsWith('regb-') && f.endsWith('.dump'))
  .sort()
  .pop()

if (!ultimo) {
  console.error('No hay ningun respaldo. Corre primero: pnpm db:respaldar')
  process.exit(1)
}

console.log(`Verificando el mas reciente: ${ultimo}\n`)

const p = spawn(
  process.execPath,
  [join(ROOT, 'scripts', 'restaurar.mjs'), join(DIR, ultimo), '--docker', contenedor, '--verificar'],
  { stdio: 'inherit' },
)
p.on('close', (code) => process.exit(code ?? 1))
