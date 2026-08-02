import 'server-only'

import postgres from 'postgres'

/**
 * Conexion a Postgres, compartida por toda la app.
 *
 * Un solo pool por proceso: en desarrollo, Next recarga los modulos en
 * caliente y sin esto acabariamos abriendo un pool por recarga hasta
 * agotar las conexiones del servidor.
 *
 * OJO: aqui NO se aplica RLS por si sola. Toda consulta a datos de un
 * cliente tiene que pasar por `asUser()`, que fija los claims y cambia al
 * rol `authenticated`. Consultar directamente con este cliente es
 * consultar como dueno de las tablas, y eso ignora las politicas.
 */

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:55432/regb_test'

declare global {
  // `var` es obligatorio aqui: `let`/`const` en `declare global` no crean la
  // propiedad en globalThis y `globalThis.__regbDb` no compilaria.
  var __regbDb: postgres.Sql | undefined
}

export function db(): postgres.Sql {
  globalThis.__regbDb ??= postgres(DB_URL, { max: 8, onnotice: () => {} })
  return globalThis.__regbDb
}

/**
 * Ejecuta consultas con la identidad de un usuario concreto.
 *
 * Fija los claims del JWT y cambia al rol `authenticated`, que NO es dueno
 * de las tablas: a partir de ahi RLS decide que filas existen (§10).
 */
export async function asUser<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({
    sub: userId,
    app_metadata: { tenant_id: tenantId, is_provider: false },
  })
  return db().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`
    await tx.unsafe('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}
