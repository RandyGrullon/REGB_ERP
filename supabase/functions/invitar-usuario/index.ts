/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Edge Function `invitar-usuario` — modulo users (0123)
 *
 *  Manda el correo de una invitacion ya creada con crear_invitacion().
 *  Existe porque `auth.admin.inviteUserByEmail` exige la llave de servicio
 *  de Supabase, y esa llave SOLO puede vivir aqui, en los secretos de la
 *  funcion (`pnpm audit:secrets` rompe la puerta si aparece en apps/).
 *
 *  Dos clientes, con papeles que no se mezclan:
 *   · `comoQuienInvita`: anon key + el JWT de quien llama. Con el se
 *     AUTORIZA, en la base: invitacion_para_enviar() mira su cliente, el
 *     modulo, el permiso users.create, que la invitacion este pendiente y
 *     que el token del enlace le corresponda. La RLS aplica.
 *   · `admin`: llave de servicio. SOLO envia el correo. No lee ni escribe
 *     ninguna tabla -si lo hiciera, la RLS no aplicaria y habria que
 *     filtrar por cliente a mano-.
 *
 *  El enlace se arma con el secreto REGB_SITE_URL, nunca con algo del
 *  request: un Host manipulado no puede meter otro dominio en el correo.
 *
 *  Secretos: SUPABASE_URL, SUPABASE_ANON_KEY y la llave de servicio los
 *  pone Supabase solo en cada funcion; REGB_SITE_URL hay que cargarlo
 *  (`supabase secrets set REGB_SITE_URL=https://app.tu-dominio.do`).
 *
 *  Respuestas:
 *   200 { enviado: true }
 *   409 { enviado: false, motivo: 'ya_registrado' }  la persona ya tiene cuenta
 *   502 { enviado: false, motivo: 'fallo', error }  Supabase no lo envio
 *   4xx { error }                                   no autorizado / datos malos
 * ═══════════════════════════════════════════════════════════════════════
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[0-9a-f]{64}$/

function responder(status: number, cuerpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return responder(405, { error: 'Solo POST.' })

  const autorizacion = req.headers.get('Authorization') ?? ''
  if (!autorizacion.startsWith('Bearer ')) {
    return responder(401, { error: 'Falta la sesion de quien invita.' })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const sitio = Deno.env.get('REGB_SITE_URL')
  if (!url || !anon || !servicio || !sitio) {
    return responder(500, {
      enviado: false,
      motivo: 'fallo',
      error: 'La funcion no esta configurada: falta el secreto REGB_SITE_URL.',
    })
  }

  let cuerpo: { invitationId?: unknown; token?: unknown }
  try {
    cuerpo = await req.json()
  } catch {
    return responder(400, { error: 'Cuerpo invalido.' })
  }
  const invitationId = typeof cuerpo.invitationId === 'string' ? cuerpo.invitationId : ''
  const token = typeof cuerpo.token === 'string' ? cuerpo.token : ''
  if (!UUID.test(invitationId) || !TOKEN.test(token)) {
    return responder(400, { error: 'Invitacion o enlace con formato invalido.' })
  }

  // ── 1. Autorizar en la base, como quien invita ────────────────────────
  const comoQuienInvita = createClient(url, anon, {
    global: { headers: { Authorization: autorizacion } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await comoQuienInvita.rpc('invitacion_para_enviar', {
    p_id: invitationId,
    p_token: token,
  })
  const destino = (Array.isArray(data) ? data[0] : null) as {
    email?: string
    nombre?: string
  } | null
  if (error || !destino?.email) {
    return responder(403, { error: error?.message ?? 'No se puede enviar esa invitacion.' })
  }

  // ── 2. Enviar. La llave de servicio, solo para esto ───────────────────
  const admin = createClient(url, servicio, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const redirectTo = `${sitio.replace(/\/+$/, '')}/auth/invitacion/${token}`
  const { error: errorEnvio } = await admin.auth.admin.inviteUserByEmail(destino.email, {
    redirectTo,
    // Solo el nombre para el saludo del correo. El token NO va aqui:
    // quedaria guardado en auth.users en claro.
    data: { display_name: destino.nombre ?? '' },
  })

  if (errorEnvio) {
    const yaExiste =
      errorEnvio.code === 'email_exists' || /already (been )?registered/i.test(errorEnvio.message)
    if (yaExiste) return responder(409, { enviado: false, motivo: 'ya_registrado' })
    console.error('[invitar-usuario]', errorEnvio.message)
    return responder(502, { enviado: false, motivo: 'fallo', error: errorEnvio.message })
  }

  return responder(200, { enviado: true })
})
