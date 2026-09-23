'use client'

import { useState, type CSSProperties } from 'react'
import { Icon, cn } from '@regb/ui'
import type { CatalogEntry } from '@/lib/catalog'

/**
 * La captura real de un modulo, con el tema correcto y un plan B digno.
 *
 * `'use client'` por una sola razon: `onError`. Si el archivo desaparece
 * despues de que el servidor lo vio (se regeneraron las capturas, una
 * cache vieja), la imagen rota se retira y queda el placeholder, sin
 * mover el layout: el placeholder SIEMPRE esta debajo, y es tambien lo
 * que se ve mientras la imagen carga.
 *
 * Contrato (`pnpm capturas:marketplace`):
 *   /marketplace/<id>.jpg        tema oscuro, 1280x800
 *   /marketplace/<id>-claro.jpg  tema claro,  1280x800
 *
 * Se montan las dos y cada una lleva `tema-si-oscuro` / `tema-si-claro`
 * (globals.css): el CSS esconde la del tema que no esta puesto segun el
 * `data-theme` de <html>. Cambiar de tema no espera a que React repinte
 * 80 tarjetas, y como las <img> son `loading="lazy"`, la oculta no se
 * descarga.
 *
 * Si falta la de un tema se usa la del otro: una pantalla real, aunque sea
 * del otro tema, vende mas que un dibujo. Si no hay ninguna, placeholder.
 */

type ModuloVisible = Pick<
  CatalogEntry,
  'id' | 'name' | 'icon' | 'category' | 'isPublished' | 'screenshots'
>

/** El color de la categoria como variable local: `--cat`. */
export const colorCategoria = (category: CatalogEntry['category']): CSSProperties =>
  ({ '--cat': `var(--color-module-category-${category})` }) as CSSProperties

export function CapturaModulo({
  mod,
  ajuste = 'cover',
  grande = false,
  className,
}: {
  mod: ModuloVisible
  /** `cover` para la tarjeta (recorta por abajo); `contain` para el visor. */
  ajuste?: 'cover' | 'contain'
  /** Placeholder con icono mas grande, para la ficha. */
  grande?: boolean
  className?: string
}) {
  const [fallo, setFallo] = useState({ oscuro: false, claro: false })

  const { dark, light } = mod.screenshots
  const srcOscuro = fallo.oscuro ? null : (dark ?? light)
  const srcClaro = fallo.claro ? null : (light ?? dark)
  const alt = `Pantalla de ${mod.name}`
  const imgClase = cn(
    'h-full w-full',
    ajuste === 'cover' ? 'object-cover object-top' : 'object-contain',
  )

  return (
    <div className={cn('relative overflow-hidden', className)} style={colorCategoria(mod.category)}>
      <Placeholder icon={mod.icon} grande={grande} />

      {srcOscuro && (
        <div className="tema-si-oscuro absolute inset-0">
          {/* <img> y no next/image: archivo estatico de tamano fijo, sin
              optimizador de por medio (la app de escritorio sirve lo mismo). */}
          <img
            src={srcOscuro}
            alt={alt}
            width={1280}
            height={800}
            loading="lazy"
            decoding="async"
            onError={() => setFallo((f) => ({ ...f, oscuro: true }))}
            className={imgClase}
          />
        </div>
      )}
      {srcClaro && (
        <div className="tema-si-claro absolute inset-0">
          <img
            src={srcClaro}
            alt={alt}
            width={1280}
            height={800}
            loading="lazy"
            decoding="async"
            onError={() => setFallo((f) => ({ ...f, claro: true }))}
            className={imgClase}
          />
        </div>
      )}

      {!mod.isPublished && (
        // Decorativo: la tarjeta y la ficha ya dicen "Proximamente" con texto.
        <span
          aria-hidden
          className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-base)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-primary)]"
        >
          <Icon name="construction" size={14} />
          Próximamente
        </span>
      )}
    </div>
  )
}

/**
 * Una ventana esquematica con el icono del modulo en el color de su
 * categoria. Se lee como "aqui va una pantalla", no como un error ni como
 * un hueco: el layout de la tarjeta no cambia haya o no captura.
 */
function Placeholder({ icon, grande }: { icon: string; grande: boolean }) {
  const linea = 'rounded-full bg-[color-mix(in_srgb,var(--cat)_16%,var(--color-border))]'
  return (
    <div
      aria-hidden
      className="absolute inset-0 bg-[color-mix(in_srgb,var(--cat)_9%,var(--color-surface-deepest))]"
    >
      <div className="absolute inset-x-[7%] bottom-0 top-[11%] flex flex-col overflow-hidden rounded-t-[var(--radius-md)] border border-b-0 border-[color-mix(in_srgb,var(--cat)_18%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-surface-base)_78%,transparent)]">
        <div className="flex h-[9%] min-h-2 items-center gap-[1.2%] border-b border-[var(--color-border)] px-[2.5%]">
          <span className="aspect-square h-[36%] rounded-full bg-[var(--color-border-strong)]" />
          <span className="aspect-square h-[36%] rounded-full bg-[var(--color-border-strong)]" />
          <span className="aspect-square h-[36%] rounded-full bg-[var(--color-border-strong)]" />
        </div>
        <div className="flex flex-1">
          <div className="flex w-[20%] flex-col gap-[7%] border-r border-[var(--color-border)] p-[3%]">
            <span className={cn(linea, 'h-[5%] w-4/5')} />
            <span className={cn(linea, 'h-[5%] w-3/5')} />
            <span className={cn(linea, 'h-[5%] w-4/5')} />
            <span className={cn(linea, 'h-[5%] w-2/5')} />
          </div>
          <div className="flex flex-1 flex-col gap-[6%] p-[3.5%]">
            <span className={cn(linea, 'h-[6%] w-1/3')} />
            <span className={cn(linea, 'h-[4%] w-11/12 opacity-70')} />
            <span className={cn(linea, 'h-[4%] w-10/12 opacity-70')} />
            <span className={cn(linea, 'h-[4%] w-11/12 opacity-70')} />
          </div>
        </div>
      </div>

      <div className="absolute inset-0 grid place-items-center">
        <span
          className={cn(
            'grid place-items-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-base)]',
            grande ? 'h-20 w-20' : 'h-14 w-14',
          )}
        >
          <Icon name={icon} size={grande ? 44 : 30} className="text-[var(--cat)]" />
        </span>
      </div>
    </div>
  )
}
