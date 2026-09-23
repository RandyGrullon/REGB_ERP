'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { Icon } from '@regb/ui'
import { COOKIE_AVISO, type Aviso as AvisoDato } from '@/lib/aviso-comun'

/**
 * El aviso de "esto se hizo", arriba a la derecha, DEBAJO de la cabecera.
 *
 * Aparece despues de guardar, editar, eliminar o cualquier accion que
 * cambie algo, y dice tambien cuando NO se pudo y por que.
 *
 * Tres decisiones que no son cosmeticas:
 *
 *  1. **El error no se va solo.** Un "listo" que desaparece a los 4
 *     segundos esta bien: el usuario ya vio el cambio en la pantalla. Un
 *     error que desaparece solo deja a alguien sin saber por que su
 *     trabajo no se guardo. Ese hay que cerrarlo a mano.
 *  2. **Color + icono + texto**, nunca color solo. Es una de las leyes
 *     de Aurora y aqui importa de verdad: en un mostrador la pantalla se
 *     mira de reojo.
 *  3. **Se borra la cookie al enseñarlo.** Si no, el aviso reaparece al
 *     recargar la pagina y el cajero cree que cobro dos veces.
 *  4. **No tapa la cabecera.** Antes flotaba a 16px del borde y caia
 *     encima de los botones de arriba -tema, campana, empresa- justo
 *     cuando el usuario queria tocarlos. Ahora se coloca 12px por debajo
 *     de lo ultimo que haya pegado arriba: la `<header>` de la pantalla
 *     (Shell, marketplace, ficha, REGB Control) y las franjas que la
 *     siguen (impersonacion, mora), marcadas con `data-bajo-la-cabecera`.
 *     Se mide en vez de fijar un numero porque esas franjas aparecen y
 *     desaparecen, y en movil la de mora ocupa dos lineas.
 */
export function Aviso({ aviso }: { aviso: AvisoDato | null }) {
  const [visible, setVisible] = useState(aviso !== null)
  // `null` = aun sin medir: vale el `top` de la clase (alto de la barra
  // superior + 12px), que ya es correcto en casi todas las pantallas.
  const [top, setTop] = useState<number | null>(null)

  // Antes de pintar, para que no salte de sitio. Solo cuenta lo que esta
  // apilado desde el borde de arriba: una <header> dentro de una tarjeta
  // no empieza donde termino la anterior, asi que no suma.
  useLayoutEffect(() => {
    if (aviso === null || !visible) return
    const medir = () => {
      let fondo = 0
      for (const el of document.querySelectorAll<HTMLElement>('header, [data-bajo-la-cabecera]')) {
        const r = el.getBoundingClientRect()
        if (r.height > 0 && r.top <= fondo + 1) fondo = Math.max(fondo, r.bottom)
      }
      setTop(fondo > 0 ? Math.round(fondo + 12) : null)
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [aviso, visible])

  useEffect(() => {
    if (aviso === null) return
    setVisible(true)
    // Un solo uso: en cuanto se pinta, deja de existir.
    document.cookie = `${COOKIE_AVISO}=; path=/; max-age=0`

    if (aviso.tipo === 'error') return
    // Con un enlace hay algo que hacer (imprimir el ticket): se le da
    // tiempo a alcanzarlo.
    const t = setTimeout(() => setVisible(false), aviso.enlace ? 10_000 : 4000)
    return () => clearTimeout(t)
  }, [aviso])

  if (aviso === null || !visible) return null

  const ok = aviso.tipo === 'ok'

  return (
    <div
      // `alert` interrumpe al lector de pantalla; `status` no. Un error
      // merece la interrupcion, una confirmacion no.
      role={ok ? 'status' : 'alert'}
      aria-live={ok ? 'polite' : 'assertive'}
      className="fixed right-4 top-[calc(var(--layout-top-bar)+0.75rem)] z-50 flex max-w-sm items-start gap-2 rounded-[var(--radius-lg)] border px-3 py-2 shadow-[var(--shadow-lg)] motion-safe:animate-[aviso_.18s_ease-out]"
      style={{
        ...(top !== null ? { top } : {}),
        borderColor: ok ? 'var(--color-semantic-success)' : 'var(--color-semantic-danger)',
        background: ok
          ? 'color-mix(in srgb, var(--color-semantic-success) 14%, var(--color-surface-raised))'
          : 'color-mix(in srgb, var(--color-semantic-danger) 14%, var(--color-surface-raised))',
      }}
    >
      <Icon
        name={ok ? 'check_circle' : 'error'}
        size={18}
        filled
        className={
          ok
            ? 'shrink-0 text-[var(--color-semantic-text-success)]'
            : 'shrink-0 text-[var(--color-semantic-text-danger)]'
        }
      />
      <p className="text-sm text-[var(--color-text-primary)]">
        {aviso.texto}
        {ok && aviso.enlace && (
          <>
            {' '}
            <a
              href={aviso.enlace.href}
              className="whitespace-nowrap font-semibold text-[var(--color-text-link)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              {aviso.enlace.texto}
            </a>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Cerrar aviso"
        className="ml-1 shrink-0 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
