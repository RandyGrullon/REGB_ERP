/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Edge Function `invitar-usuario` — modulo users (0123, 0143)
 *
 *  Manda el correo de una invitacion ya creada. Existe porque
 *  `auth.admin.inviteUserByEmail` exige la llave de servicio de Supabase,
 *  y esa llave SOLO puede vivir aqui, en los secretos de la funcion
 *  (`pnpm audit:secrets` rompe la puerta si aparece en apps/).
 *
 *  Dos formas de llamarla, y en ninguna decide la funcion quien puede:
 *  lo decide la base.
 *
 *   · Desde /usuarios: `{ invitationId, token }` con el JWT de QUIEN
 *     INVITA en `Authorization`. `invitacion_para_enviar()` mira su
 *     cliente, el modulo, el permiso users.create, que la invitacion este
 *     pendiente y que el token del enlace le corresponda. La RLS aplica.
 *
 *   · Desde el enlace, cuando la persona invitada todavia no tiene cuenta
 *     (el dueño que sale del alta de REGB Control): solo `{ token }`, sin
 *     sesion. `invitacion_por_enlace()` devuelve el correo INVITADO -nunca
 *     otro- si el token es de una invitacion viva. Tener el enlace no da
 *     acceso: el correo va a la direccion invitada, y es abrir ESE correo
 *     lo que abre la sesion. Sin esto el dueño no podia entrar nunca: el
 *     registro esta cerrado y nadie le mandaba el correo.
 *
 *  La llave de servicio (`admin`) SOLO envia el correo. No lee ni escribe
 *  ninguna tabla -si lo hiciera, la RLS no aplicaria-.
 *
 *  El enlace se arma con el secreto REGB_SITE_URL, nunca con algo del
 *  request: un Host manipulado no puede meter otro dominio en el correo.
 *
 *  `verify_jwt = false` (supabase/config.toml y al desplegar): la llamada
 *  por enlace no trae sesion, y las llaves nuevas (`sb_publishable_…`) no
 *  son JWT. La validacion la hace la base en los dos caminos.
 *
 *  Secretos: SUPABASE_URL, la llave publica y la secreta las pone Supabase
 *  solo en cada funcion (ver `llave()`); REGB_SITE_URL hay que cargarlo
 *  (`supabase secrets set REGB_SITE_URL=https://app.tu-dominio.do`). En
 *  local, `supabase/functions/.env` (no se sube al repo).
 *
 *  Respuestas:
 *   200 { enviado: true }
 *   409 { enviado: false, motivo: 'ya_registrado' }  la persona ya tiene cuenta
 *   410 { enviado: false, motivo: 'invalida'|'vencida'|'revocada'|'aceptada' }
 *   429 { enviado: false, motivo: 'espera' }          se mando hace un momento
 *   502 { enviado: false, motivo: 'fallo', error }    Supabase no lo envio
 *   4xx { error }                                     no autorizado / datos malos
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

/**
 * Una llave que Supabase inyecta en la funcion. Primero las NUEVAS
 * (`SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS`, un JSON
 * `{"default": "sb_secret_…"}`), que son las que trae un proyecto creado
 * hoy y las que la CLI 2.109 pasa en local; si no estan, las de siempre
 * (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`, JWT), que desaparecen
 * cuando se apagan las "Legacy API keys" del proyecto.
 */
function llave(nuevas: string, clasica: string): string | undefined {
  try {
    const mapa = JSON.parse(Deno.env.get(nuevas) ?? '{}') as Record<string, string>
    const nueva = mapa.default ?? Object.values(mapa)[0]
    if (nueva) return nueva
  } catch {
    // JSON roto: se sigue con la clasica.
  }
  return Deno.env.get(clasica) || undefined
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return responder(405, { error: 'Solo POST.' })

  const url = Deno.env.get('SUPABASE_URL')
  const publica = llave('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const servicio = llave('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  const sitio = Deno.env.get('REGB_SITE_URL')
  if (!url || !publica || !servicio || !sitio) {
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
  const token = typeof cuerpo.token === 'string' ? cuerpo.token : ''
  if (!TOKEN.test(token)) return responder(400, { error: 'Enlace con formato invalido.' })

  const porEnlace = cuerpo.invitationId === undefined
  let destino: { email?: string; nombre?: string } | null = null

  if (porEnlace) {
    // ── 1a. La persona invitada, sin cuenta: autoriza el token ──────────
    const anonimo = createClient(url, publica, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await anonimo.rpc('invitacion_por_enlace', { p_token: token })
    const fila = (Array.isArray(data) ? data[0] : null) as {
      resultado?: string
      email?: string | null
      nombre?: string | null
    } | null
    if (error || !fila?.resultado) {
      console.error('[invitar-usuario] invitacion_por_enlace', error?.message)
      return responder(502, {
        enviado: false,
        motivo: 'fallo',
        error: 'No se pudo leer la invitacion.',
      })
    }
    if (fila.resultado === 'espera') return responder(429, { enviado: false, motivo: 'espera' })
    if (fila.resultado !== 'ok' || !fila.email) {
      return responder(410, { enviado: false, motivo: fila.resultado })
    }
    destino = { email: fila.email, nombre: fila.nombre ?? '' }
  } else {
    // ── 1b. Desde /usuarios: autoriza quien invita, en la base ──────────
    const autorizacion = req.headers.get('Authorization') ?? ''
    if (!autorizacion.startsWith('Bearer ')) {
      return responder(401, { error: 'Falta la sesion de quien invita.' })
    }
    const invitationId = typeof cuerpo.invitationId === 'string' ? cuerpo.invitationId : ''
    if (!UUID.test(invitationId)) {
      return responder(400, { error: 'Invitacion con formato invalido.' })
    }
    const comoQuienInvita = createClient(url, publica, {
      global: { headers: { Authorization: autorizacion } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await comoQuienInvita.rpc('invitacion_para_enviar', {
      p_id: invitationId,
      p_token: token,
    })
    destino = (Array.isArray(data) ? data[0] : null) as { email?: string; nombre?: string } | null
    if (error || !destino?.email) {
      return responder(403, { error: error?.message ?? 'No se puede enviar esa invitacion.' })
    }
  }

  // ── 2. Enviar. La llave de servicio, solo para esto ───────────────────
  const admin = createClient(url, servicio, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const redirectTo = `${sitio.replace(/\/+$/, '')}/auth/invitacion/${token}`
  const { error: errorEnvio } = await admin.auth.admin.inviteUserByEmail(destino.email!, {
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

  // Por enlace no hay quien invita que lo anote despues (desde /usuarios lo
  // anota la app con marcar_invitacion_enviada): se anota aqui, por token.
  if (porEnlace) {
    const anonimo = createClient(url, publica, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anonimo.rpc('invitacion_enviada_por_enlace', { p_token: token })
    if (error) console.error('[invitar-usuario] invitacion_enviada_por_enlace', error.message)
  }

  return responder(200, { enviado: true })
})
