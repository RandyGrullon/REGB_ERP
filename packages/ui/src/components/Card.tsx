import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../utils'

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

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
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

  const arrow = delta?.direction === 'up' ? '▲' : delta?.direction === 'down' ? '▼' : '—'

  return (
    <Card className={cn('p-4', className)}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="tabular mt-1 text-2xl font-bold text-[var(--color-text-primary)]">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta && (
          <span style={{ color: deltaColor }}>
            <span aria-hidden>{arrow}</span>{' '}
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
