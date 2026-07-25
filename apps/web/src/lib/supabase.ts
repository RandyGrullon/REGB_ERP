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

/** La sesion del usuario actual, validada contra el servidor de auth. */
export async function currentSession(): Promise<RegbSession | null> {
  return sdkGetSession(await store())
}

/** ¿Hay un Supabase configurado, o corremos en modo demostracion? */
export const authConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)
