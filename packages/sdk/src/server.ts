import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { readSession, type RegbSession } from './session'

/**
 * Cliente de Supabase para el servidor (Server Components, rutas, acciones).
 *
 * Recibe el manejo de cookies de fuera para no acoplarse a Next: la app
 * de escritorio y la movil usan otro almacenamiento y el mismo codigo.
 */
export interface CookieStore {
  getAll(): { name: string; value: string }[]
  setAll(cookies: { name: string; value: string; options?: CookieOptions }[]): void
}

/** Cliente de Supabase del lado servidor. */
export type ServerClient = ReturnType<typeof createServerClient>

export function createClient(cookies: CookieStore): ServerClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: CookieOptions }[]) => {
        try {
          cookies.setAll(list)
        } catch {
          // Un Server Component no puede escribir cookies. El middleware ya
          // refresco la sesion, asi que ignorarlo aqui es correcto.
        }
      },
    },
  })
}

/**
 * La sesion del usuario actual, o null.
 *
 * Usa `getClaims()`, no `getUser()` ni `getSession()` a secas: `getClaims`
 * verifica la firma del JWT contra las claves del proyecto -tan seguro
 * como `getUser()`, sin el viaje de red al servidor de auth- y devuelve
 * los claims TAL COMO quedaron en el token, que es donde vive lo que
 * `rls.custom_access_token_hook` inyecta.
 *
 * `getUser()` NO sirve para esto: devuelve `app_metadata` desde
 * `auth.users.raw_app_meta_data`, la fila persistida -que el hook nunca
 * toca-, no desde el token firmado en este login. Se descubrio contra un
 * proyecto real: `raw_app_meta_data` solo tenia `{provider: "email"}`, y
 * `tenant_id`/`is_provider` vivian nada mas en el JWT.
 */
export async function getSession(cookies: CookieStore): Promise<RegbSession | null> {
  const supabase = createClient(cookies)
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims) return null
  const { claims } = data
  return readSession({
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    app_metadata: claims.app_metadata,
  })
}
