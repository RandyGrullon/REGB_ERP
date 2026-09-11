'use client'

import { useFormStatus } from 'react-dom'
import type { ButtonHTMLAttributes } from 'react'

/**
 * Boton de enviar que sabe cuando su formulario esta trabajando.
 *
 * `useFormStatus` lee el estado del `<form>` que lo contiene, asi que
 * esto solo funciona DENTRO de un formulario -que es justo donde hace
 * falta-. Mientras la accion corre:
 *
 *  - se deshabilita, que es lo que de verdad importa: un doble clic en
 *    "Cobrar" es un ticket duplicado, y en "Eliminar" es peor;
 *  - aparece el mismo girador que ya usa `Button` de Aurora, para que
 *    esperar se vea igual en todo el ERP;
 *  - se marca `aria-busy`, que es como se entera un lector de pantalla.
 *
 * No se cambia el texto del boton a proposito. "Crear orden" que pasa a
 * "Guardando..." y vuelve deja al usuario sin saber en cual de los dos
 * botones hizo clic cuando hay varios en pantalla; el girador dice lo
 * mismo sin mover el piso.
 */
export function BotonEnvio({
  children,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      className={className}
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && (
        // `motion-safe:` respeta a quien pidio menos animacion: sin el,
        // el girador sigue girando igual. Es una de las leyes de Aurora.
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
          aria-hidden
        />
      )}
      {children}
    </button>
  )
}
