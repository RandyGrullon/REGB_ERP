import { redirect } from 'next/navigation'
import { Icon, Logo } from '@regb/ui'
import { checkAccess } from '@regb/sdk'
import { authConfigured, currentSession } from '@/lib/supabase'
import { BotonEnvio } from '@/components/BotonEnvio'

export const metadata = { title: 'Sin acceso · REGB ERP' }
export const dynamic = 'force-dynamic'

/**
 * El login funciono pero la persona todavia no puede operar.
 *
 * Le decimos QUE pasa y QUE hacer. Un 403 mudo aqui es la diferencia entre
 * una llamada a soporte y ninguna (§11.7).
 *
 * En modo demostracion no hay sesiones -todo el mundo "entra"-, asi que
 * esta pantalla no tiene nada que explicar: se vuelve al inicio de la demo
 * con el mismo cliente y rol. Antes respondia 500: pedia la sesion a un
 * Supabase que no existe.
 */
export default async function SinAccesoPage({
  searchParams,
}: {
  searchParams?: Promise<{ tenant?: string; rol?: string }>
}) {
  if (!authConfigured) {
    const p = (await searchParams) ?? {}
    const qs = new URLSearchParams()
    if (p.tenant) qs.set('tenant', p.tenant)
    if (p.rol) qs.set('rol', p.rol)
    const query = qs.toString()
    redirect(query ? `/?${query}` : '/')
  }

  const session = await currentSession()
  const estado = session ? checkAccess(session) : null

  const icono =
    estado?.blocked && estado.reason === 'tenant-suspended'
      ? 'pause_circle'
      : estado?.blocked && estado.reason === 'tenant-archived'
        ? 'inventory_2'
        : 'mail'

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-surface-deepest)] p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <Logo variant="full" size="md" />
        <div className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 text-center">
          <span
            aria-hidden
            className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--color-surface-base)]"
          >
            <Icon name={icono} size={28} className="text-[var(--color-text-secondary)]" />
          </span>
          <h1 className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">
            Todavía no puedes entrar
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            {estado?.blocked
              ? estado.message
              : 'Tu sesión no tiene una empresa asociada. Pidele a tu administrador que te invite.'}
          </p>

          {session && (
            <p className="mt-4 text-xs text-[var(--color-text-muted)]">
              Entraste como <strong>{session.email}</strong>
            </p>
          )}

          <form action="/auth/salir" method="post" className="mt-5">
            <BotonEnvio className="text-sm text-[var(--color-text-link)] underline-offset-4 hover:underline">
              Salir y entrar con otra cuenta
            </BotonEnvio>
          </form>
        </div>
      </div>
    </main>
  )
}
