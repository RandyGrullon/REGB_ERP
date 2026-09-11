import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readSession, type RegbSession } from '@regb/sdk'
import { supabase } from './supabase'

/**
 * Sesion de REGB en el telefono.
 *
 * `readSession()` es la MISMA funcion pura que usa la web -vive en
 * @regb/sdk-, asi que el tenantId se interpreta identico en las tres
 * plataformas. Regla que no se negocia: el tenant sale de los claims y
 * de ningun otro sitio (§10).
 */

interface EstadoSesion {
  cargando: boolean
  sesion: RegbSession | null
  entrar: (email: string, password: string) => Promise<string | null>
  salir: () => Promise<void>
}

const ContextoSesion = createContext<EstadoSesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true)
  const [sesion, setSesion] = useState<RegbSession | null>(null)

  useEffect(() => {
    let vivo = true

    supabase.auth.getUser().then(({ data }) => {
      if (!vivo) return
      setSesion(data.user ? readSession(data.user) : null)
      setCargando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSesion(s?.user ? readSession(s.user) : null)
    })

    return () => {
      vivo = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const valor = useMemo<EstadoSesion>(
    () => ({
      cargando,
      sesion,
      async entrar(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error ? 'Correo o contraseña incorrectos.' : null
      },
      async salir() {
        await supabase.auth.signOut()
      },
    }),
    [cargando, sesion],
  )

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>
}

export function useSesion(): EstadoSesion {
  const ctx = useContext(ContextoSesion)
  if (!ctx) throw new Error('useSesion se uso fuera de ProveedorSesion.')
  return ctx
}
