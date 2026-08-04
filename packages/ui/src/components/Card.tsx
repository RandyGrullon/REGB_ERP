import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../utils'
import { Icon } from './Icon'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--color-border)]',
        'bg-[var(--color-surface-raised)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pt-4 pb-2', className)} {...props} />
}

/**
 * Titulo de tarjeta.
 *
 * `h2` y no `h3`: el titulo de la pantalla es el unico `h1`, asi que una
 * tarjeta colgada de el es el segundo nivel. Con `h3` quedaba el salto
 * h1 -> h3, y un lector de pantalla anuncia eso como "falta una seccion":
 * quien navega por encabezados —que es como navega mucha gente con lector—
 * se queda buscando un nivel que no existe.
 *
 * `as` permite bajar a `h3` cuando la tarjeta si cuelga de un `h2` real.
 */
export function CardTitle({
  className,
  as: Tag = 'h2',
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { as?: 'h2' | 'h3' | 'h4' }) {
  return (
    <Tag
      className={cn('text-base font-semibold text-[var(--color-text-primary)]', className)}
      {...props}
    />
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4', className)} {...props} />
}

/** Tarjeta de KPI del dashboard: cifra grande, delta y contexto. */
export interface StatCardProps {
  label: string
  value: string
  /** Cambio respecto al periodo anterior. */
  delta?: { value: string; direction: 'up' | 'down' | 'flat' }
  hint?: ReactNode
  className?: string
}

export function StatCard({ label, value, delta, hint, className }: StatCardProps) {
  const deltaColor =
    delta?.direction === 'up'
      ? 'var(--color-semantic-text-success)'
      : delta?.direction === 'down'
        ? 'var(--color-semantic-text-danger)'
        : 'var(--color-semantic-text-neutral)'

  const flecha =
    delta?.direction === 'up'
      ? 'trending_up'
      : delta?.direction === 'down'
        ? 'trending_down'
        : 'trending_flat'

  return (
    <Card className={cn('p-4', className)}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="tabular mt-1 text-2xl font-bold text-[var(--color-text-primary)]">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta && (
          <span className="inline-flex items-center gap-1" style={{ color: deltaColor }}>
            <Icon name={flecha} size={14} />
            <span className="sr-only">
              {delta.direction === 'up' ? 'sube' : delta.direction === 'down' ? 'baja' : 'igual'}
            </span>
            {delta.value}
          </span>
        )}
        {hint && <span className="text-[var(--color-text-muted)]">{hint}</span>}
      </div>
    </Card>
  )
}
