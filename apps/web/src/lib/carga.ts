/**
 * Cómo carga una página: con la bienvenida o con la barra fina.
 *
 * SIN `server-only`: el layout (servidor) mete el script en el <head> y la
 * barra (cliente) escribe la marca que el script lee.
 *
 * ── Los dos modos ─────────────────────────────────────────────────────
 *
 * - `inicio`: se abrió la app o se recargó. Mientras llega la página se
 *   ve la pantalla de bienvenida con el logo armándose y la barra arriba.
 * - `navegacion`: se llegó desde otra pantalla del ERP (un enlace o un
 *   formulario normal). Solo la barra, que sigue donde la dejó la pantalla
 *   anterior: ver el logo en cada clic cansaría.
 *
 * ── Por qué un script en el <head> y no React ────────────────────────
 *
 * El modo se tiene que saber ANTES de pintar: si lo decidiera un
 * componente, la bienvenida asomaría un instante en cada navegación hasta
 * que React la quitara. El script corre antes del <body>, pone
 * `data-carga` en el <html> y el CSS (`components/carga.css`) hace el
 * resto. Mismo motivo por el que el tema lo decide el servidor
 * (`lib/tema.ts`): nada que se decida después de pintar.
 *
 * La marca vive en `sessionStorage` (esta pestaña, nada viaja al
 * servidor) y caduca a los 15 s: un clic en un enlace de descarga no deja
 * la siguiente recarga sin bienvenida.
 */

/** Clave en `sessionStorage`: la escribe la barra al salir hacia otra pantalla del ERP. */
export const CLAVE_NAVEGANDO = 'regb-navegando'

/** Pasado este tiempo la marca ya no cuenta: no fue una navegación nuestra. */
export const VIGENCIA_NAVEGANDO_MS = 15_000

export type ModoDeCarga = 'inicio' | 'navegacion'

/**
 * Corre en el <head>, antes del <body>. En ES5 y envuelto en try: si el
 * navegador bloquea `sessionStorage` (modo privado estricto), la página
 * carga igual, en modo `inicio`.
 *
 * Recargar siempre es `inicio` aunque haya marca; ir hacia atrás o hacia
 * adelante con el navegador es `navegacion`.
 */
export const SCRIPT_MODO_DE_CARGA = `(function(){var m='inicio';try{var n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];var t=n&&n.type;var s=Number(sessionStorage.getItem('${CLAVE_NAVEGANDO}'))||0;sessionStorage.removeItem('${CLAVE_NAVEGANDO}');if(t!=='reload'&&(t==='back_forward'||Date.now()-s<${VIGENCIA_NAVEGANDO_MS}))m='navegacion'}catch(e){}document.documentElement.setAttribute('data-carga',m)})()`
