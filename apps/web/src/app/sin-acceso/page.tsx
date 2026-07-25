import { currentSession } from '@/lib/supabase'
import { checkAccess } from '@regb/sdk'

export const metadata = { title: 'Sin acceso · REGB ERP' }
export const dynamic = 'force-dynamic'

/**
 * El login funciono pero la persona todavia no puede operar.
 *
 * Le decimos QUE pasa y QUE hacer. Un 403 mudo aqui es la diferencia entre
 * una llamada a soporte y ninguna (§11.7).
 */
export default async function SinAccesoPage() {
  const session = await currentSession()
  const estado = session ? checkAccess(session) : null

  const icono =
    estado?.blocked && estado.reason === 'tenant-suspended'
      ? '⏸️'
      : estado?.blocked && estado.reason === 'tenant-archived'
        ? '🗄️'
        : '✉️'

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-surface-deepest)] p-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 text-center">
        <p className="text-4xl" aria-hidden>
          {icono}
        </p>
        <h1 className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">
          Todavia no puedes entrar
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          {estado?.blocked
            ? estado.message
            : 'Tu sesion no tiene una empresa asociada. Pidele a tu administrador que te invite.'}
        </p>

        {session && (
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            Entraste como <strong>{session.email}</strong>
          </p>
        )}

        <form action="/auth/salir" method="post" className="mt-5">
          <button
            type="submit"
            className="text-sm text-[var(--color-text-link)] underline-offset-4 hover:underline"
          >
            Salir y entrar con otra cuenta
          </button>
        </form>
      </div>
    </main>
  )
}
