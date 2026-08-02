import type { CSSProperties } from 'react'
import { cn } from '../utils'

/**
 * Iconografia del proyecto — Material Symbols (variante *rounded*).
 *
 * La fuente se sirve DESDE EL PAQUETE, no desde el CDN de Google. Dos
 * razones, ambas duras:
 *  1. El POS tiene que vender sin internet (puerta F5). Un icono que no
 *     carga deja botones vacios en la caja registradora.
 *  2. Un CDN de terceros es una peticion a un dominio ajeno en cada carga:
 *     dependencia externa y dato de navegacion que se filtra.
 *
 * Se usa la tecnica de ligadura: el NOMBRE del icono va como texto dentro
 * del span y la fuente lo sustituye por el glifo. Por eso lleva
 * `aria-hidden` y `translate="no"` — sin eso, un traductor automatico
 * traduce "settings" y el icono desaparece.
 */

export type IconWeight = 300 | 400 | 500 | 600

export interface IconProps {
  /** Nombre del icono en Material Symbols, en snake_case: `inventory_2`. */
  name: string
  /** Tamano en px. Se ajusta tambien el grosor optico de la fuente. */
  size?: number
  /** Relleno solido. Se usa para el elemento activo de la navegacion. */
  filled?: boolean
  weight?: IconWeight
  className?: string
  /** Estilos sueltos: se usa sobre todo para `color` calculado en runtime. */
  style?: CSSProperties
}

export function Icon({
  name,
  size = 20,
  filled = false,
  weight = 400,
  className,
  style,
}: IconProps) {
  return (
    <span
      aria-hidden="true"
      translate="no"
      className={cn('material-symbols-rounded select-none leading-none', className)}
      style={{
        ...style,
        fontSize: size,
        width: size,
        height: size,
        // `opsz` alinea el grosor del trazo al tamano real: un icono de 20px
        // con el trazo de uno de 48px se ve embarrado.
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
      }}
    >
      {name}
    </span>
  )
}
