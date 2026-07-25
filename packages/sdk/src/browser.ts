'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Cliente de Supabase para el navegador.
 *
 * Usa SOLO la clave anonima. Cualquier clave con mas privilegios en un
 * bundle de cliente es un hallazgo critico, y `pnpm audit:secrets` falla
 * el build si aparece (§10).
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY. Copia .env.example a .env.local.',
    )
  }

  return createBrowserClient(url, key)
}
