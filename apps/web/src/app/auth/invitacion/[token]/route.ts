import { NextResponse, type NextRequest } from 'next/server'
import { authConfigured, supabaseServer } from '@/lib/supabase'
import { esMotivoAceptar } from '@/app/usuarios/invitacion'

/**
 * Donde aterriza el enlace de una invitacion (modulo `users`, 0123).
 *
 * Vive bajo `/auth` porque tiene que ser PUBLICA: quien la abre casi
 * siempre todavia no tiene sesion -o la tiene sin cliente, que es
 * justamente lo que viene a arreglar-. El middleware deja pasar `/auth`.
 *
 * Tres pasos, todos en el servidor:
 *  1. Si el correo de Supabase trae `token_hash`, se canjea por una sesion
 *     (`verifyOtp`). Asi el invitado nuevo entra sin clave: el correo ES su
 *     prueba de identidad. Requiere la plantilla "Invite user" descrita en
 *     docs/modules/users.md.
 *  2. Sin sesion, al login -y de vuelta aqui-. El token va en la RUTA
 *     porque el middleware solo conserva el path en `siguiente`.
 *  3. Con sesion, `aceptar_invitacion(token)` con el token de ESA persona:
 *     la base compara el hash, el vencimiento y que su correo sea el
 *     invitado, y crea la membresia con SU user_id. Despues se refresca la
 *     sesion para que el hook le ponga el cliente en el token nuevo.
 */
const TOKEN = /^[0-9a-f]{64}$/
// Subconjunto de EmailOtpType de supabase-js: los que puede traer un correo.
type TipoOtp = 'invite' | 'magiclink' | 'email'
const TIPOS_OTP: readonly string[] = ['invite', 'magiclink', 'email']
const esTipoOtp = (t: string | null): t is TipoOtp => t !== null && TIPOS_OTP.includes(t)

function resultado(origin: string, motivo: string): NextResponse {
  return NextResponse.redirect(`${origin}/auth/invitacion/resultado?motivo=${motivo}`)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { origin, searchParams } = request.nextUrl
  const { token } = await params

  if (!TOKEN.test(token)) return resultado(origin, 'invalida')

  // Modo demostracion: no hay cuentas reales que puedan aceptar. Se dice,
  // en vez de fingir que entro alguien.
  if (!authConfigured) return resultado(origin, 'demo')

  const supabase = await supabaseServer()

  const tokenHash = searchParams.get('token_hash')
  const tipo = searchParams.get('type')
  if (tokenHash && esTipoOtp(tipo)) {
    const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash })
    if (error) {
      // El enlace del correo ya se uso o caduco. La invitacion puede seguir
      // viva: que entre por el login y vuelva aqui.
      const login = new URL('/login', origin)
      login.searchParams.set('siguiente', `/auth/invitacion/${token}`)
      login.searchParams.set(
        'error',
        'El enlace del correo ya se uso o caduco. Entra con tu correo y abre la invitacion otra vez.',
      )
      return NextResponse.redirect(login)
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const login = new URL('/login', origin)
    login.searchParams.set('siguiente', `/auth/invitacion/${token}`)
    return NextResponse.redirect(login)
  }

  const { data, error } = await supabase.rpc('aceptar_invitacion', { p_token: token })
  if (error) {
    console.error('[invitacion] aceptar_invitacion', error.message)
    return resultado(origin, 'error')
  }

  const fila = (Array.isArray(data) ? data[0] : data) as { resultado?: string } | null
  const motivo = fila?.resultado

  if (motivo === 'aceptada' || motivo === 'ya_aceptada' || motivo === 'ya_miembro') {
    // El token que tiene ahora salio SIN cliente. El hook solo corre al
    // emitir uno nuevo: sin este refresco seguiria "esperando invitacion"
    // hasta que caducara (una hora).
    await supabase.auth.refreshSession()
    return NextResponse.redirect(`${origin}/`)
  }

  return resultado(origin, esMotivoAceptar(motivo) ? motivo : 'error')
}
