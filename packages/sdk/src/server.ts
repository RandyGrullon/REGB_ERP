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
 * Usa `getUser()` y NO `getSession()`: `getUser` valida el token contra el
 * servidor de auth. `getSession` se fia de la cookie, que en el servidor es
 * un dato que llega del cliente y por tanto no es de fiar.
 */
export async function getSession(cookies: CookieStore): Promise<RegbSession | null> {
  const supabase = createClient(cookies)
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return readSession(data.user)
}
