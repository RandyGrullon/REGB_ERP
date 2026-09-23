'use client'

import { Icon, cn } from '@regb/ui'
import { COOKIE_TEMA, COOKIE_TEMA_MAX_AGE, temaDe } from '@/lib/tema'

/**
 * Boton de tema: oscuro ⇄ claro.
 *
 * No guarda estado de React a proposito. El tema vive en `data-theme` del
 * `<html>` (lo pinta el layout desde la cookie), y el icono y la etiqueta
 * se eligen con CSS segun ese atributo (`globals.css`). Asi el primer
 * render del servidor ya sale con el icono correcto, sin esperar a que
 * hidrate ni leer `document` durante el render.
 *
 * Sin props: lo usan el Shell y las pantallas inmersivas que no lo llevan
 * (marketplace, roles, REGB Control).
 */
export function TemaToggle({ className }: { className?: string | undefined }) {
  const cambiar = () => {
    const raiz = document.documentElement
    const nuevo = temaDe(raiz.dataset.theme) === 'dark' ? 'light' : 'dark'
    raiz.dataset.theme = nuevo
    document.cookie = `${COOKIE_TEMA}=${nuevo}; path=/; max-age=${COOKIE_TEMA_MAX_AGE}; samesite=lax`
  }

  return (
    <button
      type="button"
      onClick={cambiar}
      className={cn(
        'grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-full)] text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
        className,
      )}
    >
      {/* En oscuro se ofrece el claro, y al reves: el icono dice a donde vas.
          Cada pieza lleva su clase: un envoltorio con `display: contents`
          le quitaba el nombre al boton en el arbol de accesibilidad. */}
      <Icon name="light_mode" size={20} className="tema-si-oscuro" />
      <span className="tema-si-oscuro sr-only">Cambiar a tema claro</span>
      <Icon name="dark_mode" size={20} className="tema-si-claro" />
      <span className="tema-si-claro sr-only">Cambiar a tema oscuro</span>
    </button>
  )
}
