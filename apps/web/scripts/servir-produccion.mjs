#!/usr/bin/env node
/**
 * Sirve la compilación de producción desde `.next-prod`, al lado del
 * `next dev` de siempre (que usa `.next`). Compartir la carpeta hace que
 * el servidor de desarrollo pise la compilación y las pantallas fallen con
 * ChunkLoadError.
 *
 *   REGB_NEXT_DIST_DIR=.next-prod pnpm build   (compilar)
 *   node scripts/servir-produccion.mjs [puerto] (servir; 3200 por defecto)
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Desde apps/web y con el Next del proyecto: lanzado desde otra carpeta,
// `npx next` no lo encuentra, descarga otro Next y busca la compilacion
// donde no esta.
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const puerto = process.argv[2] ?? '3200'
const hijo = spawn('pnpm', ['exec', 'next', 'start', '-p', puerto], {
  cwd: WEB,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, REGB_NEXT_DIST_DIR: process.env.REGB_NEXT_DIST_DIR || '.next-prod' },
})
hijo.on('exit', (codigo) => process.exit(codigo ?? 0))
