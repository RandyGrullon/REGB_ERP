import { NextResponse, type NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

/**
 * Vuelta del enlace magico.
 *
 * Supabase redirige aqui con un codigo de un solo uso; lo canjeamos por
 * una sesion y mandamos al usuario a donde iba.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const siguiente = searchParams.get('siguiente') ?? '/'

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent('El enlace no traia codigo. Pide uno nuevo.')}`,
    )
  }

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        'El enlace caduco o ya se uso. Pide uno nuevo — solo sirven una vez.',
      )}`,
    )
  }

  // Ruta relativa a proposito: `siguiente` viene de la URL y no es de fiar.
  // Sin esto, un enlace preparado podria mandar al usuario a otro dominio.
  const destino = siguiente.startsWith('/') ? siguiente : '/'
  return NextResponse.redirect(`${origin}${destino}`)
}
