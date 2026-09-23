import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../utils'

/**
 * Boton, en el lenguaje de Apple.
 *
 * Pildora (`rounded-full`) en todos los tamaños: en Apple la forma de
 * pildora ES la señal de "esto es una accion", asi que un boton que no la
 * tiene se lee como una etiqueta. Peso 600: el 500 esta prohibido.
 *
 * El foco usa `brand-bright`: sobre fondo oscuro el azul de relleno se
 * pierde y el anillo no se ve.
 */
const button = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-semibold select-none',
    'transition-colors duration-100 ease-out',
    'active:translate-y-px',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
    'focus-visible:outline-[var(--color-brand-bright)]',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] active:bg-[var(--color-brand-active)]',
        secondary:
          'bg-[var(--color-surface-raised)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)]',
        ghost:
          'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
        danger:
          'bg-[var(--color-semantic-danger)] text-white hover:brightness-110 active:brightness-95',
        link: 'bg-transparent text-[var(--color-text-link)] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        // 44px de alto en `md`: objetivo tactil minimo en movil (§11.7).
        sm: 'h-8 px-4 text-[13px] rounded-full',
        md: 'h-11 px-5 text-sm rounded-full',
        lg: 'h-12 px-7 text-base rounded-full',
        icon: 'h-11 w-11 rounded-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(button({ variant, size }), className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      ) : (
        icon
      )}
      {children}
    </button>
  )
}
