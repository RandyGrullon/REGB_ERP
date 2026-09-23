import 'server-only'

import { authConfigured, supabaseServer } from '@/lib/supabase'
import type { EnvioCorreo } from './invitacion'

/**
 * Manda el correo de una invitacion por la Edge Function `invitar-usuario`.
 *
 * La app NO tiene -ni puede tener- la llave que manda correos de Supabase
 * (`auth.admin.inviteUserByEmail` exige la llave de servicio, que solo
 * vive en los secretos de la Edge Function). Aqui se llama a la funcion
 * con el token de QUIEN INVITA, que el cliente de Supabase pone solo en el
 * encabezado Authorization; la funcion comprueba en la base -con ese mismo
 * token- que puede invitar y que el enlace corresponde a la invitacion.
 *
 * Sin Supabase configurado no hay a quien llamar, y se dice tal cual:
 * `{ enviado: false, motivo: 'demo' }`. Nunca se finge un envio.
 */
interface RespuestaFuncion {
  enviado?: boolean
  motivo?: string
  error?: string
}

export async function enviarInvitacionPorCorreo(p: {
  invitationId: string
  token: string
}): Promise<EnvioCorreo> {
  if (!authConfigured) return { enviado: false, motivo: 'demo', detalle: null }

  try {
    const supabase = await supabaseServer()
    const { data, error } = await supabase.functions.invoke<RespuestaFuncion>('invitar-usuario', {
      body: { invitationId: p.invitationId, token: p.token },
    })
    if (!error && data?.enviado === true) return { enviado: true }

    // Con un 4xx/5xx el cuerpo viene en `error.context`, no en `data`.
    let cuerpo: RespuestaFuncion | null = data ?? null
    const contexto: unknown = error && 'context' in error ? error.context : null
    if (contexto instanceof Response) {
      cuerpo = (await contexto.json().catch(() => null)) as RespuestaFuncion | null
    }

    if (cuerpo?.motivo === 'ya_registrado') {
      return { enviado: false, motivo: 'ya_registrado', detalle: null }
    }
    return {
      enviado: false,
      motivo: 'fallo',
      detalle: cuerpo?.error ?? error?.message ?? 'respuesta inesperada del servicio de correo',
    }
  } catch (e) {
    return { enviado: false, motivo: 'fallo', detalle: e instanceof Error ? e.message : String(e) }
  }
}
