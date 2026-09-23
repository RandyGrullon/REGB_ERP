import type { ReactNode } from 'react'
import { Icon } from '@regb/ui'

/**
 * El credito de un cliente, en una tarjeta: limite, saldo, disponible y
 * atraso, y -si esta bloqueado- el porque en palabras del mostrador.
 *
 * Lo pintan el pedido, la ficha del cliente y "sin facturar" de Por
 * cobrar, con los MISMOS numeros que usa la accion (lib/credito.ts): si la
 * tarjeta dice "bloqueado", confirmar dice lo mismo.
 *
 * `children` es donde va el formulario de excepcion, solo para quien la
 * puede autorizar.
 */

export interface ResumenCredito {
  allowed: boolean
  mensaje: string | null
  creditLimit: number | null
  exposure: number
  available: number | null
  oldestOverdueDays: number
  overdueBlockDays: number | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function EstadoDeCredito({
  s,
  titulo,
  compacto = false,
  children,
}: {
  s: ResumenCredito
  titulo?: string
  /** Sin las cifras: solo el estado y el mensaje (para listas). */
  compacto?: boolean
  children?: ReactNode
}) {
  const bloqueado = !s.allowed
  const atrasado = s.oldestOverdueDays > 0

  return (
    <section
      aria-label={titulo ?? 'Credito del cliente'}
      className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
    >
      <div className="flex items-start gap-3">
        <span
          className={
            bloqueado
              ? 'text-[var(--color-semantic-text-danger)]'
              : 'text-[var(--color-semantic-text-success)]'
          }
        >
          <Icon name={bloqueado ? 'block' : 'verified'} size={20} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {titulo ?? (bloqueado ? 'Credito bloqueado' : 'Credito al dia')}
          </p>
          {bloqueado && s.mensaje && (
            <p className="text-sm text-[var(--color-text-secondary)]">{s.mensaje}</p>
          )}
        </div>
      </div>

      {!compacto && (
        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[var(--color-text-muted)]">Limite</dt>
            <dd className="tabular text-sm font-semibold text-[var(--color-text-primary)]">
              {s.creditLimit === null ? 'Sin limite' : `RD$ ${money(s.creditLimit)}`}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Saldo pendiente</dt>
            <dd className="tabular text-sm font-semibold text-[var(--color-text-primary)]">
              RD$ {money(s.exposure)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Disponible</dt>
            <dd
              className={`tabular text-sm font-semibold ${
                s.available !== null && s.available < 0
                  ? 'text-[var(--color-semantic-text-danger)]'
                  : 'text-[var(--color-text-primary)]'
              }`}
            >
              {s.available === null ? '—' : `RD$ ${money(s.available)}`}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Mas atrasada</dt>
            <dd
              className={`tabular text-sm font-semibold ${
                atrasado
                  ? 'text-[var(--color-semantic-text-warning)]'
                  : 'text-[var(--color-text-primary)]'
              }`}
            >
              {atrasado ? `${s.oldestOverdueDays} dias` : 'Al dia'}
              <span className="block text-[11px] font-normal text-[var(--color-text-muted)]">
                {s.overdueBlockDays === null
                  ? 'sin bloqueo por vencidas'
                  : `bloquea desde ${s.overdueBlockDays + 1} dias`}
              </span>
            </dd>
          </div>
        </dl>
      )}

      {children && <div className="mt-3 border-t border-[var(--color-border)] pt-3">{children}</div>}
    </section>
  )
}
