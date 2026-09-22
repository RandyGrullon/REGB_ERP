import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Pruebas de apps/web.
 *
 * Hay dos clases de prueba aqui y no necesitan lo mismo:
 *
 *  - Las estaticas (guia-tour.test.ts) leen archivos y no tocan la base.
 *    Son las que corre la puerta F0, que no levanta Postgres.
 *  - Las de ACCIONES (`*.accion.test.ts`) llaman a la server action real
 *    contra la base de pruebas. Son las que faltaban: antes solo `tsc`
 *    garantizaba que una pagina llamara a la funcion correcta, y varias
 *    pruebas de F6 comprobaban una copia del SQL, no la accion.
 *
 * Por eso el script `test` del package excluye las de acciones y
 * `test:acciones` las corre aparte. `npx vitest run --root apps/web`
 * corre las dos.
 */
const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src}/` },
      // `server-only` lanza a proposito si se importa fuera de un React
      // Server Component. En la prueba ESTAMOS en el servidor: el candado
      // no aplica, pero sin el alias ningun modulo de lib/ carga.
      { find: /^server-only$/, replacement: `${src}/test/vacio.ts` },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/preparar.ts'],
    env: {
      // La base de pruebas, no la del dev server. Se respeta si ya viene.
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test',
      // Vacias a proposito: sin Supabase, actionCtx() arma el contexto en
      // MODO DEMOSTRACION -tenant y rol por FormData-, que es lo que deja
      // sembrar un cliente de mentira por prueba sin un servidor de auth.
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    },
    // Un solo proceso: las pruebas de acciones comparten la base y el pool
    // de lib/db vive en globalThis.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
