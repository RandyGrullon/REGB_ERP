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

/** El Postgres de Docker local no habla SSL; cualquier otro host, si. */
const ES_LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DB_URL)

export function db(): postgres.Sql {
  globalThis.__regbDb ??= postgres(DB_URL, {
    max: 8,
    // Supabase en produccion pasa por Supavisor en modo transaccion, que
    // NO admite sentencias preparadas: con ellas sale "prepared statement
    // ... does not exist" en cuanto dos peticiones caen en conexiones
    // fisicas distintas. `asUser` ya es compatible con ese modo porque
    // todo lo que fija identidad es `local` (ver `audit:identidad`).
    prepare: false,
    ...(ES_LOCAL ? {} : { ssl: 'require' as const }),
    onnotice: () => {},
  })
  return globalThis.__regbDb
}

/**
 * Ejecuta consultas con la identidad de un usuario concreto.
 *
 * Fija los claims del JWT y cambia al rol `authenticated`, que NO es dueno
 * de las tablas: a partir de ahi RLS decide que filas existen (§10).
 *
 * Los claims llevan el `role_id` REAL de esa persona en ese cliente, igual
 * que el token que emite el hook (0008). Antes no lo llevaban, y
 * `rls.has_perm()` -sin rol en el token no decide- respondia true a todo:
 * las politicas que miran el permiso (0109, 0127) solo aplicaban por
 * PostgREST, nunca en la web. El rol se busca YA como `authenticated` y con
 * el tenant en los claims, asi la busqueda pasa por la RLS de
 * `memberships` y no depende de que el usuario de la conexion la salte.
 * Sin membresia activa (modo demostracion sobre un cliente sembrado por una
 * prueba) no hay rol que poner, y todo sigue como antes: manda `exigir()`.
 *
 * Todo es local a la transaccion (`set_config(..., true)`, `set local`):
 * ver `audit:identidad`.
 */
export async function asUser<T>(
  userId: string,
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const claims = (roleId?: string) =>
    JSON.stringify({
      sub: userId,
      app_metadata: {
        tenant_id: tenantId,
        is_provider: false,
        ...(roleId ? { role_id: roleId } : {}),
      },
    })
  return db().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims()}, true)`
    await tx.unsafe('set local role authenticated')
    const [m] = await tx<{ role_id: string }[]>`
      select role_id from public.memberships
      where tenant_id = ${tenantId} and user_id = ${userId}
        and is_active and accepted_at is not null
      limit 1`
    if (m) await tx`select set_config('request.jwt.claims', ${claims(m.role_id)}, true)`
    return fn(tx)
  }) as Promise<T>
}
