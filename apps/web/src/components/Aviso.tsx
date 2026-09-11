'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@regb/ui'
import { COOKIE_AVISO, type Aviso as AvisoDato } from '@/lib/aviso-comun'

/**
 * El aviso de "esto se hizo", arriba a la derecha.
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
 */
export function Aviso({ aviso }: { aviso: AvisoDato | null }) {
  const [visible, setVisible] = useState(aviso !== null)

  useEffect(() => {
    if (aviso === null) return
    setVisible(true)
    // Un solo uso: en cuanto se pinta, deja de existir.
    document.cookie = `${COOKIE_AVISO}=; path=/; max-age=0`

    if (aviso.tipo === 'error') return
    const t = setTimeout(() => setVisible(false), 4000)
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
      className="fixed right-4 top-4 z-50 flex max-w-sm items-start gap-2 rounded-[var(--radius-lg)] border px-3 py-2 shadow-[var(--shadow-lg)] motion-safe:animate-[aviso_.18s_ease-out]"
      style={{
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
      <p className="text-sm text-[var(--color-text-primary)]">{aviso.texto}</p>
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
