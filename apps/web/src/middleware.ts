import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { inicioPorSesion } from '@/lib/inicio-por-sesion'
import { rutaInterna } from '@/lib/ruta-interna'

/**
 * Refresco de sesion y guardia de rutas.
 *
 * Corre antes que cualquier pagina. Hace dos cosas:
 *  1. Refresca el token si caduco, para que los Server Components reciban
 *     una sesion valida y no tengan que preocuparse por ello.
 *  2. Manda al login a quien no tenga sesion.
 *
 * Si no hay Supabase configurado (modo demostracion local), no estorba.
 */

const PUBLICAS = [
  '/login',
  '/auth',
  '/sin-acceso',
  // Las URL que el contribuyente declara a la DGII. NO llevan sesion de
  // empleado por definicion: la DGII y otros emisores les pegan desde
  // internet, y su credencial es el token opaco de la propia URL.
  //
  // Sin esta linea el middleware las contestaba con un redirect a /login
  // en cuanto Supabase esta configurado, o sea que en PRODUCCION estaban
  // MUERTAS -y en desarrollo funcionaban, porque sin Supabase el
  // middleware se aparta-. Un fallo que solo aparece donde importa.
  '/api/ecf/',
  // Lo que llama un programador de tareas (Vercel Cron, `pnpm alertas`,
  // `pnpm despachar`). No traen sesion de nadie: se protegen con su propio
  // secreto (`Authorization: Bearer $REGB_CRON_SECRET`) y sin el responden
  // 401/503. Mismo fallo que /api/ecf/: con Supabase configurado el
  // middleware las mandaba a /login con un 307, el cron "funcionaba" y los
  // eventos -asientos automaticos, automatizaciones, webhooks- no salian.
  '/api/eventos/despachar',
  '/api/salud',
  '/api/alertas',
]

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Sin Supabase configurado la app corre en modo demostracion: el
  // bootstrap simula la sesion y el middleware no debe bloquear nada.
  if (!url || !key) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list: { name: string; value: string; options?: CookieOptions }[]) => {
        for (const c of list) request.cookies.set(c.name, c.value)
        response = NextResponse.next({ request })
        // Objeto y no (name, value, options): las opciones de @supabase/ssr
        // y las de Next no coinciden campo a campo, y la firma de tres
        // argumentos exige el tipo exacto de Next.
        for (const c of list) response.cookies.set({ name: c.name, value: c.value, ...c.options })
      },
    },
  })

  // getUser y no getSession: valida el token contra el servidor de auth.
  // La cookie llega del cliente y por tanto no es de fiar.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const esPublica = PUBLICAS.some((p) => path.startsWith(p))

  // Una redireccion tiene que llevarse las cookies que getUser() acaba de
  // refrescar: si no, el navegador se queda con el token viejo y la
  // siguiente peticion vuelve a refrescar (o a caer al login).
  const redirigir = (destino: URL) => {
    const r = NextResponse.redirect(destino)
    for (const c of response.cookies.getAll()) r.cookies.set(c)
    return r
  }

  if (!user && !esPublica) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    // Para devolverlo a donde iba despues de entrar.
    login.searchParams.set('siguiente', path)
    return redirigir(login)
  }

  // Con sesion, "el inicio" depende de quien es: el proveedor no tiene
  // cliente (su inicio es /control) y quien no tiene cliente o lo tiene
  // suspendido no puede pintar `/`. Sin esto, `/` -> /login -> `/` era un
  // bucle (ver inicio-por-sesion.ts). Solo se leen los claims aqui, en las
  // dos rutas que lo necesitan.
  if (user && (path === '/' || path === '/login')) {
    const { data } = await supabase.auth.getClaims()
    const inicio = data?.claims ? inicioPorSesion(data.claims) : '/'

    if (path === '/login') {
      // Si venia de algun sitio (una invitacion, una pantalla), alli.
      let ruta = rutaInterna(request.nextUrl.searchParams.get('siguiente'))
      if (ruta === '/' || ruta.startsWith('/login')) ruta = inicio
      return redirigir(new URL(ruta, request.nextUrl.origin))
    }
    if (inicio !== '/') return redirigir(new URL(inicio, request.nextUrl.origin))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
