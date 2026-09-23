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
    return `Le enviamos la invitacion a ${email}. El enlace sirve una sola vez y vence en ${DIAS_DE_VIGENCIA} dias.`
  }
  switch (envio.motivo) {
    case 'demo':
      return `No se envio ningun correo: estas en modo demostracion y no hay servidor de correo conectado. Copia el enlace y compartelo tu con ${email}.`
    case 'ya_registrado':
      return `No se envio ningun correo: ${email} ya tiene cuenta en REGB y Supabase no le manda invitacion. Compartele el enlace; al abrirlo con su cuenta queda dentro.`
    case 'fallo':
      return `La invitacion quedo creada, pero el correo NO salio${envio.detalle ? ` (${envio.detalle})` : ''}. Comparte el enlace a mano o toca Reenviar mas tarde.`
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
      'No encontramos una invitacion con ese enlace. Puede que la hayan reenviado -el enlace anterior deja de servir- o que se copiara incompleto. Pidele a tu administrador uno nuevo.',
  },
  vencida: {
    titulo: 'La invitacion vencio',
    texto: `Las invitaciones duran ${DIAS_DE_VIGENCIA} dias. Pidele a tu administrador que te la reenvie desde Usuarios.`,
  },
  revocada: {
    titulo: 'La invitacion fue revocada',
    texto:
      'Quien te invito la cancelo. Si crees que es un error, habla con el administrador de tu empresa.',
  },
  otro_correo: {
    titulo: 'Entraste con otro correo',
    texto:
      'Esta invitacion es para otra direccion de correo. Sal y entra con la cuenta del correo al que te llego la invitacion.',
  },
  otro_cliente: {
    titulo: 'Tu cuenta ya es de otra empresa',
    texto:
      'Hoy una cuenta de REGB pertenece a una sola empresa. Pidele a quien te invito que use otro correo tuyo.',
  },
  ya_miembro: {
    titulo: 'Ya estas dentro',
    texto: 'Tu cuenta ya pertenece a este equipo. No hizo falta aceptar nada.',
  },
  correo_sin_confirmar: {
    titulo: 'Falta confirmar tu correo',
    texto: 'Abre el enlace que te llego por correo para confirmarlo y vuelve a intentarlo.',
  },
  sin_sesion: {
    titulo: 'Necesitas entrar primero',
    texto: 'Entra con el correo al que te llego la invitacion y vuelve a abrir el enlace.',
  },
  demo: {
    titulo: 'Modo demostracion',
    texto:
      'Aqui no hay cuentas reales, asi que nadie puede aceptar una invitacion. Cuando REGB este conectado a Supabase, este mismo tipo de enlace crea el acceso de la persona.',
  },
  error: {
    titulo: 'No pudimos aceptar la invitacion',
    texto: 'Algo fallo de nuestro lado. Intenta abrir el enlace otra vez en unos minutos.',
  },
} as const

export type MotivoAceptar = keyof typeof RESULTADOS_ACEPTAR

export function esMotivoAceptar(x: string | undefined): x is MotivoAceptar {
  return x !== undefined && Object.prototype.hasOwnProperty.call(RESULTADOS_ACEPTAR, x)
}
