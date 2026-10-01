/**
 * Carga el archivo de variables de la RAIZ del repo (`.env.local`) para los
 * scripts de base (`pnpm db:migrar`, `db:demo`, `db:alta-proveedor`,
 * `db:verificar-supabase`). Se usa como `node --import ./scripts/entorno.mjs
 * <script>`: corre antes que el script y no hay que tocarlo.
 *
 * ── Por que ───────────────────────────────────────────────────────────
 *
 * Conectar el proyecto de Supabase tiene que ser "rellenar un archivo y
 * correr un comando" (docs/SUPABASE.md). Sin esto habia que escribir
 * `DATABASE_URL=... pnpm ...`, que en PowerShell ni siquiera es la sintaxis.
 *
 * `.env.local` de la RAIZ y no el de `apps/web`: Next no lee el de la raiz,
 * asi que llenarlo no saca a la web del modo demostracion por accidente.
 *
 * ── Las dos cadenas de conexion ───────────────────────────────────────
 *
 * Las migraciones, la semilla y los respaldos usan `DATABASE_URL_MIGRACIONES`
 * (el *Session pooler* de Supabase, puerto 5432) si existe. La app usa
 * `DATABASE_URL` (el *Transaction pooler*, 6543). Por el pooler de
 * transacciones no pasan las sentencias preparadas que usan estos scripts
 * (postgres.js las usa por defecto; la app las apaga con `prepare: false`).
 *
 * Lo que ya venga en el entorno manda sobre el archivo: `process.loadEnvFile`
 * no pisa variables existentes.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const ARCHIVO = join(RAIZ, '.env.local')

if (existsSync(ARCHIVO)) process.loadEnvFile(ARCHIVO)

if (process.env.DATABASE_URL_MIGRACIONES) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_MIGRACIONES
} else if (/:6543\//.test(process.env.DATABASE_URL ?? '')) {
  console.error(
    'DATABASE_URL apunta al Transaction pooler (puerto 6543), que no sirve para migrar.\n' +
      'Pon la cadena del *Session pooler* (puerto 5432) en DATABASE_URL_MIGRACIONES.\n' +
      'Ver docs/SUPABASE.md, paso 3.',
  )
  process.exit(1)
}
