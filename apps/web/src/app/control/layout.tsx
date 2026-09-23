import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from '@regb/ui'
import { ControlNav } from './ControlNav'
import { BotonEnvio } from '@/components/BotonEnvio'
import { Aviso } from '@/components/Aviso'
import { leerAviso } from '@/lib/aviso'

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
export default async function ControlLayout({ children }: { children: ReactNode }) {
  // El panel del proveedor no pasa por `modulePage()`, asi que lee el
  // aviso por su cuenta: sin esto, generar facturas o mover una etapa de
  // onboarding no confirmaria nada.
  const aviso = await leerAviso()

  return (
    <div className="flex h-full min-h-screen flex-col bg-[var(--color-surface-base)]">
      <Aviso aviso={aviso} />
      <header
        className="flex h-14 shrink-0 items-center gap-3 border-b-2 px-4"
        style={{ borderColor: 'var(--color-accent-plum)' }}
      >
        <span className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] text-[13px] font-bold text-white"
            style={{ background: 'var(--color-accent-plum)' }}
          >
            R
          </span>
          <span className="text-sm font-bold text-[var(--color-text-primary)]">
            REGB Control
            <span className="ml-2 hidden font-normal text-[var(--color-text-muted)] sm:inline">
              Panel del propietario
            </span>
          </span>
        </span>

        <span className="hidden h-6 w-px shrink-0 bg-[var(--color-border)] sm:block" aria-hidden />

        <ControlNav />

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            <Icon name="arrow_back" size={16} />
            <span className="hidden sm:inline">Volver al ERP</span>
          </Link>
          <span className="h-6 w-px shrink-0 bg-[var(--color-border)]" aria-hidden />
          <form action="/auth/salir" method="post">
            <BotonEnvio
              
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
              <Icon name="logout" size={16} />
              <span className="hidden sm:inline">Salir</span>
            </BotonEnvio>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-y-auto p-4 md:p-6">
        {children}
      </main>
    </div>
  )
}
