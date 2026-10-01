/**
 * Lo que comparten las acciones de invitar, la pantalla (servidor y
 * navegador) y la ruta que acepta: formas y textos. Nada de servidor aqui
 * -lo importa un componente cliente-.
 *
 * La regla que ordena todo este archivo: la pantalla NUNCA dice "enviada"
 * si el correo no salio. Solo `{ enviado: true }` -que llega cuando la Edge
 * Function respondio que Supabase acepto el envio- produce ese texto.
 */

/** Que paso con el correo de una invitacion. */
export type EnvioCorreo =
  | { enviado: true }
  | {
      enviado: false
      /**
       * demo: no hay Supabase conectado, no existe servidor de correo.
       * ya_registrado: esa persona ya tiene cuenta; Supabase no invita dos veces.
       * fallo: se intento y no salio.
       */
      motivo: 'demo' | 'ya_registrado' | 'fallo'
      detalle: string | null
    }

export type ResultadoInvitacion =
  | { ok: false; error: string }
  | {
      ok: true
      email: string
      envio: EnvioCorreo
      /** Solo cuando el correo NO salio: el enlace para compartirlo a mano. */
      enlace: string | null
    }

/** Dias que vive una invitacion. Lo mismo que el default de la base (0123). */
export const DIAS_DE_VIGENCIA = 7

/**
 * El enlace que abre la persona invitada. El token va en la RUTA y no en
 * la query: el middleware manda al login conservando solo el path en
 * `siguiente`, y una query se perderia por el camino.
 */
export function enlaceDeInvitacion(origen: string, token: string): string {
  return `${origen.replace(/\/+$/, '')}/auth/invitacion/${token}`
}

/** El mensaje que ve quien invito. Qué pasó · por qué · qué hacer. */
export function mensajeDeEnvio(email: string, envio: EnvioCorreo): string {
  if (envio.enviado) {
    return `Le enviamos la invitación a ${email}. El enlace sirve una sola vez y vence en ${DIAS_DE_VIGENCIA} días.`
  }
  switch (envio.motivo) {
    case 'demo':
      return `No se envió ningún correo: estás en modo demostración y no hay servidor de correo conectado. Copia el enlace y compártelo tú con ${email}.`
    case 'ya_registrado':
      return `No se envió ningún correo: ${email} ya tiene cuenta en REGB y Supabase no le manda invitación. Compártele el enlace; al abrirlo con su cuenta queda dentro.`
    case 'fallo':
      return `La invitación quedó creada, pero el correo NO salió${envio.detalle ? ` (${envio.detalle})` : ''}. Comparte el enlace a mano o toca Reenviar más tarde.`
  }
}

/**
 * Lo que devuelve `public.aceptar_invitacion()` y como se le explica a
 * quien abrio el enlace. Solo se aceptan estos codigos en la pagina de
 * resultado: cualquier otro valor de la URL cae en el generico.
 */
export const RESULTADOS_ACEPTAR = {
  invalida: {
    titulo: 'Ese enlace no sirve',
    texto:
      'No encontramos una invitación con ese enlace. Puede que la hayan reenviado -el enlace anterior deja de servir- o que se copiara incompleto. Pídele a tu administrador uno nuevo.',
  },
  vencida: {
    titulo: 'La invitación venció',
    texto: `Las invitaciones duran ${DIAS_DE_VIGENCIA} días. Pídele a tu administrador que te la reenvíe desde Usuarios.`,
  },
  revocada: {
    titulo: 'La invitación fue revocada',
    texto:
      'Quien te invitó la canceló. Si crees que es un error, habla con el administrador de tu empresa.',
  },
  otro_correo: {
    titulo: 'Entraste con otro correo',
    texto:
      'Esta invitación es para otra dirección de correo. Sal y entra con la cuenta del correo al que te llegó la invitación.',
  },
  otro_cliente: {
    titulo: 'Tu cuenta ya es de otra empresa',
    texto:
      'Hoy una cuenta de REGB pertenece a una sola empresa. Pídele a quien te invitó que use otro correo tuyo.',
  },
  ya_miembro: {
    titulo: 'Ya estas dentro',
    texto: 'Tu cuenta ya pertenece a este equipo. No hizo falta aceptar nada.',
  },
  correo_sin_confirmar: {
    titulo: 'Falta confirmar tu correo',
    texto: 'Abre el enlace que te llegó por correo para confirmarlo y vuelve a intentarlo.',
  },
  sin_sesion: {
    titulo: 'Necesitas entrar primero',
    texto: 'Entra con el correo al que te llegó la invitación y vuelve a abrir el enlace.',
  },
  demo: {
    titulo: 'Modo demostración',
    texto:
      'Aquí no hay cuentas reales, así que nadie puede aceptar una invitación. Cuando REGB este conectado a Supabase, este mismo tipo de enlace crea el acceso de la persona.',
  },
  error: {
    titulo: 'No pudimos aceptar la invitación',
    texto: 'Algo fallo de nuestro lado. Intenta abrir el enlace otra vez en unos minutos.',
  },
} as const

export type MotivoAceptar = keyof typeof RESULTADOS_ACEPTAR

export function esMotivoAceptar(x: string | undefined): x is MotivoAceptar {
  return x !== undefined && Object.prototype.hasOwnProperty.call(RESULTADOS_ACEPTAR, x)
}
