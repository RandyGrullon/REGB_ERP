import 'server-only'

import { cookies } from 'next/headers'
import type { ActionResult } from './module-page'
import { COOKIE_AVISO, type Aviso } from './aviso-comun'

/**
 * El aviso de "esto se hizo" (o de por que no se hizo).
 *
 * Hasta hoy las acciones devolvian `ActionResult` y los envoltorios
 * `*Form` lo TIRABAN: `await crearPedido(fd)` y listo. El resultado era
 * que guardar bien y fallar se veian exactamente igual -no pasaba nada
 * en pantalla-. Eso ya mordio en `marketing`, donde una transicion
 * bloqueada no mostraba nada y parecia que el boton estaba roto.
 *
 * Por que una cookie y no estado de React: las 352 formas del ERP son
 * `<form action={accionDelServidor}>` planas, sin JavaScript de por
 * medio. Devolver el resultado a la pantalla con `useActionState`
 * obligaria a convertir cada una en componente cliente -352 archivos- y
 * a perder el envio sin JS. Con una cookie de un solo uso, la accion
 * anota que paso, `revalidatePath` vuelve a pintar la pagina, y
 * `modulePage()` -por donde pasan TODAS- lo lee y lo entrega al Shell.
 * Una pieza, todas las pantallas.
 *
 * La cookie NO es httpOnly a proposito: el componente que la pinta la
 * borra desde el navegador en cuanto la enseña, para que un aviso no
 * reaparezca al recargar. No lleva nada sensible: un verbo y, cuando
 * algo falla, el mismo mensaje que ya se le iba a enseñar al usuario.
 */

export { COOKIE_AVISO, type Aviso } from './aviso-comun'

/**
 * Que decir cuando algo sale bien, deducido del nombre de la accion.
 *
 * Se deduce en vez de escribirse 297 veces a mano por una razon
 * practica: un texto por accion se escribe una vez y se desactualiza
 * solas. El verbo, en cambio, es lo unico que el usuario necesita
 * confirmar -"¿se borro o no se borro?"-.
 *
 * En español dominicano y en primera persona del plural, como pide
 * Aurora: "Guardamos tu cambio" antes que "Operacion exitosa".
 */
const VERBOS: { prueba: RegExp; texto: string }[] = [
  { prueba: /^(crear|agregar|añadir|nuevo|registrar|abrir|emitir|generar|invitar|importar)/i, texto: 'Listo, lo agregamos.' },
  { prueba: /^(eliminar|borrar|quitar|remover)/i, texto: 'Listo, lo eliminamos.' },
  { prueba: /^(anular|cancelar)/i, texto: 'Listo, quedo anulado.' },
  { prueba: /^(cerrar|finalizar|completar|terminar|confirmar|aprobar|entregar|recibir|pagar|cobrar|conciliar|contabilizar|enviar|publicar|activar)/i, texto: 'Listo, quedo hecho.' },
  { prueba: /^(rechazar|denegar)/i, texto: 'Listo, quedo rechazado.' },
  { prueba: /^(alternar|cambiar|mover|transicionar|reprogramar|asignar|marcar)/i, texto: 'Listo, lo cambiamos.' },
]

export function textoDeExito(accion: string): string {
  for (const v of VERBOS) if (v.prueba.test(accion)) return v.texto
  return 'Guardamos tu cambio.'
}

/**
 * Anota el resultado de una accion para que la proxima pantalla lo diga.
 *
 * Devuelve el mismo resultado que recibe para poder encadenarlo sin
 * cambiar el flujo de quien llama.
 */
export async function anotarAviso(
  r: ActionResult,
  accion: string,
  /**
   * Texto exacto para cuando el verbo deducido queda mal. Ej.: "enviar a
   * la papelera" empieza por "enviar" y saldria como "quedo hecho", que
   * no le dice al usuario que su archivo se fue a la papelera.
   */
  texto?: string,
  /** Solo se pinta si salio bien: un error no lleva a ningun sitio. */
  enlace?: Aviso['enlace'],
): Promise<ActionResult> {
  const aviso: Aviso = r.ok
    ? { tipo: 'ok', texto: texto ?? textoDeExito(accion), ...(enlace ? { enlace } : {}) }
    : { tipo: 'error', texto: r.error }

  const jar = await cookies()
  jar.set(COOKIE_AVISO, JSON.stringify(aviso), {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    // Corta: un aviso que sobrevive diez minutos aparece en una pantalla
    // que no tiene nada que ver con lo que se hizo.
    maxAge: 30,
  })
  return r
}

/** Lee el aviso pendiente, si lo hay. Quien lo pinta se encarga de borrarlo. */
export async function leerAviso(): Promise<Aviso | null> {
  const crudo = (await cookies()).get(COOKIE_AVISO)?.value
  if (!crudo) return null
  try {
    const a = JSON.parse(crudo) as Aviso
    if (a.tipo !== 'ok' && a.tipo !== 'error') return null
    if (typeof a.texto !== 'string' || a.texto === '') return null
    // La cookie la puede escribir cualquiera en su navegador: un enlace
    // solo se acepta si es una ruta de la propia app (nada de
    // `javascript:` ni dominios de fuera).
    const e = a.enlace
    const enlaceValido =
      e && typeof e.href === 'string' && /^\/(?!\/)/.test(e.href) && typeof e.texto === 'string'
    return { tipo: a.tipo, texto: a.texto, ...(enlaceValido ? { enlace: e } : {}) }
  } catch {
    return null
  }
}
