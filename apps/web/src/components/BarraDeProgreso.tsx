'use client'

import { useEffect, useRef } from 'react'
import { CLAVE_NAVEGANDO } from '@/lib/carga'

/**
 * La barra fina de arriba: "esto va".
 *
 * Vive en el layout raíz, fuera del Suspense, así que está en el primer
 * trozo de HTML de cada página y no se desmonta al cambiar de pantalla.
 * No ocupa sitio (`position: fixed`), no recibe clics
 * (`pointer-events: none`) y no toca el contenido: nada salta.
 *
 * ── Qué la enciende ───────────────────────────────────────────────────
 *
 * 1. **Mientras carga la página** (abrir, recargar o llegar desde otra
 *    pantalla): la enciende el CSS, sin JavaScript, mientras exista la
 *    pantalla de carga del Suspense (`html:has(.regb-carga)`). Tiene que
 *    ser así porque en ese momento React todavía no ha arrancado.
 * 2. **Al salir hacia otra pantalla** con un enlace `<a href>` o un
 *    formulario normal: se enciende al instante en la pantalla que se va
 *    y deja la marca `regb-navegando` para que la siguiente sepa que es
 *    una navegación y no enseñe la bienvenida (`lib/carga.ts`).
 * 3. **Mientras corre una acción del servidor** (o una navegación del
 *    router de Next): se mide el `fetch` que las lleva, reconocible por
 *    sus cabeceras `Next-Action` y `RSC`. Solo si tarda más de 150 ms:
 *    guardar algo rápido no debe hacer parpadear nada.
 *
 * Al terminar, el CSS la completa y la desvanece. Con movimiento reducido
 * es una línea quieta que aparece y desaparece.
 *
 * `'use client'`: escucha clics, envíos y peticiones del navegador.
 */

/** Por debajo de esto una acción no enseña barra: sería un parpadeo. */
const DEMORA_ACCION_MS = 150

/**
 * Tope de seguridad. Si la pantalla sigue viva pasado este tiempo, lo que
 * se pulsó no era una navegación (p. ej. una descarga sin `download`): la
 * barra se apaga en vez de quedarse encendida para siempre.
 */
const TOPE_MS = 15_000

/** Lo que responde un archivo y no una pantalla: no hay carga que enseñar. */
function esDescarga(url: URL): boolean {
  return url.pathname.startsWith('/api/') || url.pathname.endsWith('/descargar')
}

export function BarraDeProgreso() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const barra = ref.current
    if (!barra) return

    let pendientes = 0
    let demora: number | undefined
    let tope: number | undefined

    const apagar = () => {
      window.clearTimeout(demora)
      window.clearTimeout(tope)
      delete barra.dataset.estado
    }
    const encender = () => {
      window.clearTimeout(tope)
      barra.dataset.estado = 'cargando'
      tope = window.setTimeout(apagar, TOPE_MS)
    }

    // ── 1 y 2. Salir hacia otra pantalla ────────────────────────────
    const saliendo = () => {
      try {
        sessionStorage.setItem(CLAVE_NAVEGANDO, String(Date.now()))
      } catch {
        // Sin sessionStorage la siguiente pantalla carga en modo inicio.
      }
      encender()
    }

    const alClic = (e: MouseEvent) => {
      // Ctrl/Cmd/Mayús-clic o botón central: se abre en otra pestaña.
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const enlace = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (!(enlace instanceof HTMLAnchorElement)) return
      if ((enlace.target && enlace.target !== '_self') || enlace.hasAttribute('download')) return
      const destino = new URL(enlace.href, window.location.href)
      if (destino.origin !== window.location.origin || esDescarga(destino)) return
      // Solo cambia el #: la pantalla no se recarga.
      const aqui = window.location
      if (destino.pathname === aqui.pathname && destino.search === aqui.search && destino.hash) {
        return
      }
      saliendo()
    }

    const alEnviar = (e: SubmitEvent) => {
      // Si React lo previno, es una acción del servidor: la mide el fetch.
      if (e.defaultPrevented) return
      const form = e.target
      if (!(form instanceof HTMLFormElement)) return
      if (form.target && form.target !== '_self') return
      const destino = new URL(form.action || window.location.href, window.location.href)
      if (destino.origin !== window.location.origin || esDescarga(destino)) return
      saliendo()
    }

    // Volver atrás a una pantalla guardada en la caché del navegador
    // (bfcache): vuelve tal cual estaba, con la barra encendida.
    const alMostrar = (e: PageTransitionEvent) => {
      if (e.persisted) apagar()
    }

    // ── 3. Acciones del servidor y navegaciones del router ──────────
    const fetchOriginal = window.fetch
    const fetchMedido: typeof window.fetch = (entrada, opciones) => {
      const cabeceras = new Headers(
        opciones?.headers ?? (entrada instanceof Request ? entrada.headers : undefined),
      )
      const esNuestra =
        cabeceras.has('next-action') ||
        (cabeceras.get('rsc') === '1' &&
          !cabeceras.has('next-router-prefetch') &&
          !cabeceras.has('next-hmr-refresh'))
      const respuesta = fetchOriginal.call(window, entrada, opciones)
      if (!esNuestra) return respuesta

      pendientes += 1
      if (pendientes === 1) {
        window.clearTimeout(demora)
        demora = window.setTimeout(encender, DEMORA_ACCION_MS)
      }
      return respuesta.finally(() => {
        pendientes = Math.max(0, pendientes - 1)
        // Un respiro antes de apagar: si a la acción le sigue otra
        // petición (redirigir a otra pantalla), la barra no se corta.
        window.setTimeout(() => {
          if (pendientes === 0) apagar()
        }, 60)
      })
    }
    window.fetch = fetchMedido

    // En burbuja y en `window`: llega después de los manejadores de React
    // (que escuchan en el documento), así `defaultPrevented` ya es fiable.
    window.addEventListener('click', alClic)
    window.addEventListener('submit', alEnviar)
    window.addEventListener('pageshow', alMostrar)
    return () => {
      window.removeEventListener('click', alClic)
      window.removeEventListener('submit', alEnviar)
      window.removeEventListener('pageshow', alMostrar)
      if (window.fetch === fetchMedido) window.fetch = fetchOriginal
      apagar()
    }
  }, [])

  return <div ref={ref} className="regb-barra" aria-hidden="true" />
}
