import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Cliente de Supabase para React Native (apps/mobile)
 *
 *  NO usa `@supabase/ssr` como `browser.ts`: ese paquete depende de las
 *  cookies del navegador, que en un telefono no existen. Aqui la sesion
 *  se guarda en el almacenamiento del dispositivo que le pasemos
 *  -AsyncStorage o expo-secure-store-, inyectado desde la app para que
 *  este paquete no dependa de ningun runtime nativo en particular.
 *
 *  Igual que en web: SOLO la clave anonima. RLS es lo que decide que
 *  filas existen; el telefono no tiene ningun privilegio extra por ser
 *  una app instalada (§10).
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Lo minimo que Supabase necesita para persistir la sesion en el dispositivo. */
export interface AlmacenSesion {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export interface OpcionesClienteNativo {
  url: string
  anonKey: string
  almacen: AlmacenSesion
}

/**
 * Crea el cliente que usa la app movil.
 *
 * `detectSessionInUrl: false` a proposito: en un telefono no hay una URL
 * de retorno de OAuth que interceptar como en el navegador, y dejarlo
 * activo hace que Supabase intente leer `window.location` -que no
 * existe- en el arranque.
 */
export function createNativeClient({ url, anonKey, almacen }: OpcionesClienteNativo): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error('Faltan la URL y la clave anonima de Supabase. Revisa la configuracion de la app movil.')
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      storage: almacen,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
}
