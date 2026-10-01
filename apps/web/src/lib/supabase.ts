import 'server-only'

import { cookies } from 'next/headers'
import type { CookieOptions } from '@supabase/ssr'
import {
  createClient as createSdkClient,
  getSession as sdkGetSession,
  type ServerClient,
} from '@regb/sdk/server'
import type { RegbSession } from '@regb/sdk'

/**
 * Puente entre las cookies de Next y el cliente del SDK.
 *
 * El SDK no conoce Next a proposito: Electron y React Native guardan la
 * sesion en otro sitio y comparten el mismo codigo (§15.2).
 */
async function store() {
  const jar = await cookies()
  return {
    getAll: () => jar.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (list: { name: string; value: string; options?: CookieOptions }[]) => {
      for (const c of list) jar.set({ name: c.name, value: c.value, ...c.options })
    },
  }
}

export async function supabaseServer(): Promise<ServerClient> {
  return createSdkClient(await store())
}

/** ¿Hay un Supabase configurado, o corremos en modo demostracion? */
export const authConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

/**
 * La sesion del usuario actual, validada contra el servidor de auth.
 *
 * Sin Supabase configurado no hay sesion que leer: null, en vez de dejar que
 * el SDK lance "Faltan NEXT_PUBLIC_SUPABASE_URL..." y la pagina que pregunta
 * responda 500 (le pasaba a /sin-acceso en modo demostracion).
 */
export async function currentSession(): Promise<RegbSession | null> {
  if (!authConfigured) return null
  return sdkGetSession(await store())
}
