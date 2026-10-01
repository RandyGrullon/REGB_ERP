import { describe, expect, it } from 'vitest'
import { currentSession } from '@/lib/supabase'

/**
 * /sin-acceso en modo demostracion respondia 500 en produccion: pedia la
 * sesion a un Supabase que no existe ("Faltan NEXT_PUBLIC_SUPABASE_URL…").
 * Ahora vuelve al inicio de la demo con el mismo cliente y rol.
 *
 * `redirect()` de Next lo sustituye src/test/preparar.ts por un error con
 * la URL: asi se lee a donde mando la pagina.
 */
describe('/sin-acceso en modo demostracion', () => {
  it('currentSession() no lanza sin Supabase: no hay sesion que leer', async () => {
    await expect(currentSession()).resolves.toBeNull()
  })

  it('vuelve al inicio de la demo con el mismo cliente y rol', async () => {
    const { default: SinAcceso } = await import('./page')
    await expect(
      SinAcceso({
        searchParams: Promise.resolve({ tenant: 'distribuidora-caribe', rol: 'Gerente General' }),
      }),
    ).rejects.toThrow('redirect(/?tenant=distribuidora-caribe&rol=Gerente+General)')
  })

  it('sin parametros, al inicio a secas', async () => {
    const { default: SinAcceso } = await import('./page')
    await expect(SinAcceso({})).rejects.toThrow('redirect(/)')
  })
})
