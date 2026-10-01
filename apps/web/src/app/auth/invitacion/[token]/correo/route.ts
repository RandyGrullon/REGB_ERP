import { NextResponse, type NextRequest } from 'next/server'
import { authConfigured, supabaseServer } from '@/lib/supabase'

/**
 * "Mandarme el correo para entrar" desde /auth/invitacion/<token>/entrar.
 *
 * Llama a la Edge Function `invitar-usuario` SOLO con el token del enlace
 * (sin sesion: quien llega aqui todavia no tiene cuenta). La funcion le
 * pregunta a la base -`invitacion_por_enlace()`, 0143- a que correo va esa
 * invitacion, y le manda ahi la invitacion de Supabase. Quien pulsa el
 * boton no elige el destino: si no es la persona invitada, el correo le
 * llega a la persona invitada y no a el.
 *
 * POST y no GET: manda un correo. Las respuestas son 303 a paginas que
 * explican que paso; ningun texto sale de la respuesta de la funcion.
 */
const TOKEN = /^[0-9a-f]{64}$/

interface RespuestaFuncion {
  enviado?: boolean
  motivo?: string
}

const MOTIVOS_DE_RESULTADO = new Set(['invalida', 'vencida', 'revocada'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { origin } = request.nextUrl
  const { token } = await params
  const ir = (ruta: string) => NextResponse.redirect(`${origin}${ruta}`, { status: 303 })

  if (!TOKEN.test(token)) return ir('/auth/invitacion/resultado?motivo=invalida')
  if (!authConfigured) return ir('/auth/invitacion/resultado?motivo=demo')

  const entrar = `/auth/invitacion/${token}/entrar`

  let status = 0
  let cuerpo: RespuestaFuncion | null = null
  try {
    const supabase = await supabaseServer()
    const { data, error } = await supabase.functions.invoke<RespuestaFuncion>('invitar-usuario', {
      body: { token },
    })
    if (!error) {
      status = 200
      cuerpo = data
    } else {
      // Con un 4xx/5xx el cuerpo viene en `error.context` (una Response).
      const contexto: unknown = 'context' in error ? error.context : null
      if (contexto instanceof Response) {
        status = contexto.status
        cuerpo = (await contexto.json().catch(() => null)) as RespuestaFuncion | null
      }
      if (status === 0 || status >= 500) console.error('[invitacion/correo]', error.message)
    }
  } catch (e) {
    console.error('[invitacion/correo]', e instanceof Error ? e.message : e)
  }

  if (status === 200 && cuerpo?.enviado === true) return ir(`${entrar}?aviso=enviado`)
  if (status === 429) return ir(`${entrar}?aviso=espera`)
  if (status === 409 && cuerpo?.motivo === 'ya_registrado') {
    // Ya tiene cuenta (otra invitacion, o es alguien del proveedor): que
    // entre con ella y vuelva aqui, donde se acepta con esa sesion.
    const login = new URL('/login', origin)
    login.searchParams.set('siguiente', `/auth/invitacion/${token}`)
    login.searchParams.set(
      'error',
      'Ese correo ya tiene cuenta en REGB. Entra con tu contraseña o pide un enlace de acceso, y la invitación se acepta sola.',
    )
    return NextResponse.redirect(login, { status: 303 })
  }
  if (status === 410) {
    const motivo = cuerpo?.motivo === 'aceptada' ? 'invalida' : cuerpo?.motivo
    return ir(
      `/auth/invitacion/resultado?motivo=${motivo && MOTIVOS_DE_RESULTADO.has(motivo) ? motivo : 'invalida'}`,
    )
  }
  return ir(`${entrar}?aviso=fallo`)
}
