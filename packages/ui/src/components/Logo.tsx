import type { CSSProperties } from 'react'
import { cn } from '../utils'

/**
 * Logo de REGB ERP — «la R que brota».
 *
 * Una loseta azul (el acento de marca) con una R blanca hecha de cuatro
 * piezas que encajan. Lo que cuenta:
 *
 *  - **Módulos que encajan.** La R no es un trazo: son cuatro piezas
 *    separadas por la misma holgura, como los módulos que el cliente va
 *    activando. Ninguna sobra y ninguna tapa a otra.
 *  - **Dominicano.** La holgura entre las piezas dibuja una cruz que parte
 *    la letra en cuatro cuarteles, como la cruz blanca de la bandera.
 *  - **Que crece.** El lazo de la R es una hoja con la punta hacia arriba y
 *    a la derecha: el negocio que brota. Por eso tiene dos esquinas vivas
 *    (la que encaja en la cruz y la punta) y dos redondeadas.
 *
 * Sin engranajes ni gráficas de barras, a propósito.
 *
 * ── Uso ──────────────────────────────────────────────────────────────
 *
 *   <Logo />                          símbolo de 28 px
 *   <Logo variant="full" size="lg" /> símbolo + «REGB»
 *   <Logo size={20} decorative />     junto a un texto que ya dice REGB
 *
 * Los colores salen de los tokens (`--color-brand` para la loseta,
 * `--color-text-on-brand` para la R), así que el mismo logo sirve en los
 * dos temas sin variantes. El nombre usa `--color-text-primary`.
 *
 * Legible a 16 px: la holgura mide 4/64 del lado, un píxel a ese tamaño.
 *
 * Cada pieza lleva `data-pieza` para que la pantalla de carga la anime
 * (`apps/web/src/components/carga.css`); el componente en sí no se mueve.
 */

/** Trazados en una caja de 64×64. Fuente única: `icon.svg` y el icono de Apple los copian. */
export const LOGO_TRAZOS = {
  /** Loseta con esquinas continuas (squircle), no un rectángulo con `rx`. */
  loseta:
    'M23.2 0H40.8c8.12 0 12.18 0 15.28 1.58a14.5 14.5 0 0 1 6.34 6.34c1.58 3.1 1.58 7.16 1.58 15.28V40.8c0 8.12 0 12.18 -1.58 15.28a14.5 14.5 0 0 1 -6.34 6.34c-3.1 1.58 -7.16 1.58 -15.28 1.58H23.2c-8.12 0 -12.18 0 -15.28 -1.58a14.5 14.5 0 0 1 -6.34 -6.34c-1.58 -3.1 -1.58 -7.16 -1.58 -15.28V23.2c0 -8.12 0 -12.18 1.58 -15.28a14.5 14.5 0 0 1 6.34 -6.34c3.1 -1.58 7.16 -1.58 15.28 -1.58Z',
  /** Mitad de arriba del asta. */
  asta: 'M20 14H24.5A1.5 1.5 0 0 1 26 15.5V28.5A1.5 1.5 0 0 1 24.5 30H18.5A1.5 1.5 0 0 1 17 28.5V17A3 3 0 0 1 20 14Z',
  /** Mitad de abajo del asta. */
  base: 'M18.5 34H24.5A1.5 1.5 0 0 1 26 35.5V48.5A1.5 1.5 0 0 1 24.5 50H20A3 3 0 0 1 17 47V35.5A1.5 1.5 0 0 1 18.5 34Z',
  /** El lazo: una hoja con la punta arriba a la derecha. */
  hoja: 'M30 28.5V22A8 8 0 0 1 38 14H45.5A1.5 1.5 0 0 1 47 15.5V22A8 8 0 0 1 39 30H31.5A1.5 1.5 0 0 1 30 28.5Z',
  /** La pata. */
  pata: 'M30.64 35.36Q30 34 31.5 34L37.5 34Q39 34 39.64 35.36L45.86 48.64Q46.5 50 45 50L39 50Q37.5 50 36.86 48.64Z',
} as const

const TAMANOS = { sm: 20, md: 28, lg: 40, xl: 64 } as const

export interface LogoProps {
  /** `symbol`: solo la loseta. `full`: loseta + «REGB». */
  variant?: 'symbol' | 'full'
  /** Alto del símbolo en px: `sm` 20 · `md` 28 · `lg` 40 · `xl` 64, o un número. */
  size?: keyof typeof TAMANOS | number
  /**
   * Sin nombre accesible. Úsalo cuando al lado ya hay un texto que dice
   * REGB (la barra superior): si no, el lector lo anuncia dos veces.
   */
  decorative?: boolean
  className?: string
  style?: CSSProperties
}

export function Logo({
  variant = 'symbol',
  size = 'md',
  decorative = false,
  className,
  style,
}: LogoProps) {
  const px = typeof size === 'number' ? size : TAMANOS[size]
  const completo = variant === 'full'

  const simbolo = (
    <svg
      viewBox="0 0 64 64"
      width={px}
      height={px}
      // Con nombre en texto al lado, el SVG es decoracion: el nombre ya lo lee.
      aria-hidden={decorative || completo ? true : undefined}
      role={decorative || completo ? undefined : 'img'}
      aria-label={decorative || completo ? undefined : 'REGB'}
      focusable="false"
      className="block shrink-0"
      data-logo=""
    >
      <path data-pieza="loseta" d={LOGO_TRAZOS.loseta} fill="var(--color-brand)" />
      <g fill="var(--color-text-on-brand)">
        <path data-pieza="asta" d={LOGO_TRAZOS.asta} />
        <path data-pieza="base" d={LOGO_TRAZOS.base} />
        <path data-pieza="pata" d={LOGO_TRAZOS.pata} />
        <path data-pieza="hoja" d={LOGO_TRAZOS.hoja} />
      </g>
    </svg>
  )

  if (!completo) {
    return (
      <span className={cn('inline-flex shrink-0', className)} style={style}>
        {simbolo}
      </span>
    )
  }

  return (
    <span
      className={cn('inline-flex shrink-0 items-center', className)}
      style={{ gap: Math.round(px * 0.3), ...style }}
      {...(decorative ? { 'aria-hidden': true } : {})}
    >
      {simbolo}
      <span
        translate="no"
        className="font-bold leading-none tracking-tight text-[var(--color-text-primary)]"
        style={{ fontSize: Math.round(px * 0.58) }}
      >
        REGB
      </span>
    </span>
  )
}
