import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon } from '@regb/ui'
import { ControlNav } from './ControlNav'
import { BotonEnvio } from '@/components/BotonEnvio'
import { Aviso } from '@/components/Aviso'
import { TemaToggle } from '@/components/TemaToggle'
import { leerAviso } from '@/lib/aviso'
import { impersonacionAbiertaDe } from '@/lib/control-datos'
import { authConfigured, currentSession } from '@/lib/supabase'
import { terminarImpersonacion } from './solicitudes-actions'

export const metadata = { title: 'REGB Control' }

/** El usuario del proveedor en la demo (el mismo de las acciones de Control). */
const DEMO_PROVIDER_USER = '00000000-0000-0000-0000-00000000f00d'

/**
 * Zona del propietario (§7, §12.4).
 *
 * Se marca con la barra negra/clara (`--color-accent-plum`, que desde el
 * lenguaje Apple es el color del texto principal), no con un segundo
 * acento. Lo que va ENCIMA de esa barra usa el fondo como color de texto:
 * en oscuro la barra es casi blanca, y el blanco fijo de antes no se veia.
 *
 * La verificacion de acceso NO vive aqui: cada page llama a
 * `requireProvider()`, porque un layout no es una barrera de seguridad.
 */
export default async function ControlLayout({ children }: { children: ReactNode }) {
  // El panel del proveedor no pasa por `modulePage()`, asi que lee el
  // aviso por su cuenta: sin esto, generar facturas o mover una etapa de
  // onboarding no confirmaria nada.
  const aviso = await leerAviso()

  // Una sesion dentro de un cliente que sigue abierta. El "Terminar" del
  // banner del cliente trae aqui: este es el sitio donde se cierra de
  // verdad (antes solo navegaba y la sesion quedaba abierta).
  let quien = DEMO_PROVIDER_USER
  if (authConfigured) {
    const s = await currentSession()
    if (s?.isProvider) quien = s.userId
  }
  const abierta = await impersonacionAbiertaDe(quien).catch(() => null)

  return (
    <div className="flex h-full min-h-screen flex-col bg-[var(--color-surface-base)]">
      <Aviso aviso={aviso} />
      <header className="shrink-0 border-b-2" style={{ borderColor: 'var(--color-accent-plum)' }}>
        <div className="flex h-14 items-center gap-3 px-4">
          <span className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-[var(--radius-md)] text-[13px] font-bold text-[var(--color-surface-base)]"
              style={{ background: 'var(--color-accent-plum)' }}
            >
              R
            </span>
            <span className="text-sm font-bold text-[var(--color-text-primary)]">
              REGB Control
              <span className="ml-2 hidden font-normal text-[var(--color-text-muted)] lg:inline">
                Panel del propietario
              </span>
            </span>
          </span>

          <span
            className="hidden h-6 w-px shrink-0 bg-[var(--color-border)] md:block"
            aria-hidden
          />

          {/* En escritorio, en la barra; en el telefono, en su propia fila. */}
          <div className="hidden min-w-0 md:block">
            <ControlNav />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <TemaToggle />
            <Link
              href="/"
              aria-label="Volver al ERP"
              className="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="arrow_back" size={16} />
              <span className="hidden sm:inline">Volver al ERP</span>
            </Link>
            <span className="h-6 w-px shrink-0 bg-[var(--color-border)]" aria-hidden />
            <form action="/auth/salir" method="post">
              <BotonEnvio
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="logout" size={16} />
                <span className="hidden sm:inline">Salir</span>
              </BotonEnvio>
            </form>
          </div>
        </div>
        <div className="border-t border-[var(--color-border)] px-2 py-1.5 md:hidden">
          <ControlNav />
        </div>
      </header>

      {abierta && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-xs text-[var(--color-surface-base)]"
          style={{ background: 'var(--color-accent-plum)' }}
        >
          <Icon name="visibility" size={16} />
          <span>
            Sigues con una sesión abierta dentro de <strong>{abierta.tenant}</strong>. Ciérrala si
            ya terminaste: mientras esté abierta, puedes ver sus datos.
          </span>
          <form action={terminarImpersonacion}>
            <BotonEnvio className="flex h-8 items-center rounded-full border border-current px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
              Cerrar la sesión
            </BotonEnvio>
          </form>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1600px] flex-1 overflow-y-auto p-4 md:p-6">
        {children}
      </main>
    </div>
  )
}
