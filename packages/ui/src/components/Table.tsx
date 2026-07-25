import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '../utils'

/**
 * Tabla densa de Aurora.
 *
 * Filas de 40px, encabezado sticky, hover en toda la fila. "Denso pero
 * respirable": un ERP muestra cientos de lineas, no tres tarjetas (§11.2).
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <table className={cn('w-full border-collapse text-left text-[13px]', className)} {...props} />
    </div>
  )
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'sticky top-0 z-10 bg-[var(--color-surface-deep)]',
        'text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]',
        className,
      )}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-[var(--color-border)]', className)} {...props} />
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'h-10 transition-colors duration-100 hover:bg-[var(--color-surface-overlay)]',
        className,
      )}
      {...props}
    />
  )
}

export interface CellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean
}

export function TH({ className, numeric, ...props }: CellProps) {
  return (
    <th
      scope="col"
      className={cn('px-3 py-2 font-bold', numeric && 'text-right', className)}
      {...props}
    />
  )
}

export function TD({
  className,
  numeric,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2 text-[var(--color-text-secondary)]',
        numeric && 'tabular text-right',
        className,
      )}
      {...props}
    />
  )
}

/** Codigo, SKU, RNC: siempre en monoespaciada para poder compararlos. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="font-[family-name:var(--font-mono)] text-[12px] text-[var(--color-text-muted)]">
      {children}
    </span>
  )
}
