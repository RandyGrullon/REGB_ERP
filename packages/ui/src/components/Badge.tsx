import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '../utils'

/**
 * Pildora de estado.
 *
 * Ley de Aurora: el estado NUNCA se comunica solo con color. Siempre
 * color + punto + texto, para quien no distingue rojo de verde (§11.7).
 */
const badge = cva(
  [
    'inline-flex items-center gap-1.5 whitespace-nowrap',
    'rounded-[var(--radius-full)] px-2 py-0.5',
    'text-xs font-medium',
  ],
  {
    variants: {
      tone: {
        neutral: 'bg-[var(--color-surface-raised)] text-[var(--color-semantic-text-neutral)]',
        success:
          'bg-[color-mix(in_srgb,var(--color-semantic-success)_18%,transparent)] text-[var(--color-semantic-text-success)]',
        warning:
          'bg-[color-mix(in_srgb,var(--color-semantic-warning)_18%,transparent)] text-[var(--color-semantic-text-warning)]',
        danger:
          'bg-[color-mix(in_srgb,var(--color-semantic-danger)_18%,transparent)] text-[var(--color-semantic-text-danger)]',
        info: 'bg-[color-mix(in_srgb,var(--color-semantic-info)_18%,transparent)] text-[var(--color-semantic-text-info)]',
        brand: 'bg-[var(--color-brand-soft)] text-[var(--color-brand-bright)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

const dotColor: Record<NonNullable<VariantProps<typeof badge>['tone']>, string> = {
  neutral: 'var(--color-semantic-neutral)',
  success: 'var(--color-semantic-success)',
  warning: 'var(--color-semantic-warning)',
  danger: 'var(--color-semantic-danger)',
  info: 'var(--color-semantic-info)',
  brand: 'var(--color-brand)',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {
  /** Punto de color a la izquierda, como el estado en linea de Discord. */
  dot?: boolean
}

export function Badge({ className, tone = 'neutral', dot = true, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone }), className)} {...props}>
      {dot && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: dotColor[tone ?? 'neutral'] }}
          aria-hidden
        />
      )}
      {children}
    </span>
  )
}
