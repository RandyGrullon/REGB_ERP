import Link from 'next/link'
import type { ReactNode } from 'react'

export const metadata = { title: 'REGB Control' }

/**
 * Zona del propietario (§7, §12.4).
 *
 * Cromatica propia: el acento ciruela marca que aqui se opera POR ENCIMA
 * de los tenants. Si la barra es ciruela, no estas dentro de un cliente.
 *
 * La verificacion de acceso NO vive aqui: cada page llama a
 * `requireProvider()`, porque un layout no es una barrera de seguridad.
 */
export default function ControlLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-screen flex-col bg-[var(--color-surface-base)]">
      <header
        className="flex h-14 shrink-0 items-center gap-4 border-b-2 px-4"
        style={{ borderColor: 'var(--color-accent-plum)' }}
      >
        <p className="text-sm font-bold text-[var(--color-text-primary)]">
          REGB Control
          <span className="ml-2 hidden font-normal text-[var(--color-text-muted)] sm:inline">
            Panel del propietario
          </span>
        </p>
        <nav aria-label="Secciones" className="flex items-center gap-1 text-sm">
          <Link
            href="/control"
            className="rounded-[var(--radius-md)] px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Clientes
          </Link>
          <Link
            href="/control/facturacion"
            className="rounded-[var(--radius-md)] px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Facturacion
          </Link>
          <Link
            href="/control/onboarding"
            className="rounded-[var(--radius-md)] px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Onboarding
          </Link>
        </nav>
        <div className="ml-auto">
          <Link
            href="/"
            className="rounded-[var(--radius-md)] px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            ← Volver al ERP
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
    </div>
  )
}
