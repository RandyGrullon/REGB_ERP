'use client'

import { useRouter } from 'next/navigation'
import { Icon } from '@regb/ui'

/**
 * Atras y adelante, junto al buscador.
 *
 * En el navegador ya existen, pero el ERP tambien corre dentro de
 * Electron -y ahi la ventana NO tiene barra de navegacion-. Sin estos
 * botones, el cajero que entra a una factura desde el listado no tiene
 * forma de volver mas que buscar el enlace de vuelta en la pantalla.
 *
 * `router.back()` y `router.forward()` usan el historial de verdad, el
 * mismo que las teclas del navegador: no es un "volver al listado"
 * inventado que se pierde cuando la ruta anterior no era un listado.
 *
 * 44x44 de area tactil aunque el icono sea de 18: es la ley de Aurora y
 * en una tablet de mostrador se nota.
 */
export function Navegacion() {
  const router = useRouter()

  const clase =
    'flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'

  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={() => router.back()} aria-label="Volver atras" title="Atras" className={clase}>
        <Icon name="arrow_back" size={18} />
      </button>
      <button
        type="button"
        onClick={() => router.forward()}
        aria-label="Ir adelante"
        title="Adelante"
        className={clase}
      >
        <Icon name="arrow_forward" size={18} />
      </button>
    </div>
  )
}
