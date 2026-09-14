import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { allowed, type Role, type Scope } from '@regb/permissions'
import { supabase } from './supabase'

/**
 * Que puede hacer este usuario, para pintar el menu.
 *
 * ── Esto es ergonomia, NO seguridad ───────────────────────────────────
 *
 * Lo que decide de verdad es la RLS y los permisos de la base. Ocultar
 * una opcion aqui no impide nada a quien le hable directo a PostgREST:
 * el telefono lleva la anon key dentro y eso es publico por diseño.
 *
 * Sirve para lo otro, que tambien importa: no llevar a un cajero a una
 * pantalla que no puede usar. Un 403 al segundo toque es la peor forma
 * de enterarse de que no tienes permiso.
 *
 * Se usa `can()` de @regb/permissions -el mismo evaluador de la web- con
 * los mismos datos, servidos por `public.mi_rol()`. No es una segunda
 * implementacion de las reglas: es la misma.
 */
interface FilaRol {
  id: string
  name: string
  visible_modules: string[]
  permissions: Record<string, boolean>
  scope: Scope
}

interface Estado {
  cargando: boolean
  rol: Role | null
  modulos: Set<string>
  /** Si el rol concede la accion sobre ese modulo. */
  puede: (accion: string, moduleId: string) => boolean
}

const Ctx = createContext<Estado>({
  cargando: true,
  rol: null,
  modulos: new Set(),
  puede: () => false,
})

export function ProveedorPermisos({ children }: { children: ReactNode }) {
  const [rol, setRol] = useState<Role | null>(null)
  const [modulos, setModulos] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    void (async () => {
      // Las dos de una vez: el menu necesita las dos cosas y pedirlas en
      // serie deja la pantalla en blanco el doble de tiempo.
      const [r, m] = await Promise.all([
        supabase.rpc('mi_rol'),
        supabase.rpc('mis_modulos'),
      ])

      const fila = ((r.data as FilaRol[] | null) ?? [])[0]
      setRol(
        fila === undefined
          ? null
          : {
              id: fila.id,
              name: fila.name,
              visibleModules: fila.visible_modules,
              permissions: fila.permissions,
              scope: fila.scope,
            },
      )
      setModulos(
        new Set(((m.data as { module_id: string }[] | null) ?? []).map((x) => x.module_id)),
      )
      setCargando(false)
    })()
  }, [])

  const puede = (accion: string, moduleId: string): boolean => {
    // Sin rol cargado NO se abre la puerta: lo peor que pasa es que el
    // menu salga corto un instante. Al reves -enseñar de mas mientras
    // carga- el usuario alcanza a tocar.
    if (rol === null) return false
    return allowed(accion, { module: moduleId }, { userId: rol.id, role: rol, activeModules: modulos })
  }

  return <Ctx.Provider value={{ cargando, rol, modulos, puede }}>{children}</Ctx.Provider>
}

export const usePermisos = (): Estado => useContext(Ctx)
