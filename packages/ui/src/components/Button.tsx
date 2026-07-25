import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../utils'

/**
 * Boton de Aurora.
 *
 * El foco usa `brand-bright`, no `brand`: el blurple puro da 2.74:1 sobre
 * fondo oscuro y el anillo no se ve (§11.7).
 */
const button = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium select-none',
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
        sm: 'h-8 px-3 text-[13px] rounded-[var(--radius-md)]',
        md: 'h-11 px-4 text-sm rounded-[var(--radius-md)]',
        lg: 'h-12 px-6 text-base rounded-[var(--radius-md)]',
        icon: 'h-11 w-11 rounded-[var(--radius-md)]',
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
