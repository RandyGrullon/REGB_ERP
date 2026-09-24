import { Icon } from '@regb/ui'
import { RESULTADOS_ACEPTAR, esMotivoAceptar } from '@/app/usuarios/invitacion'

export const metadata = { title: 'Invitación · REGB ERP' }

/**
 * Por que una invitacion no se pudo aceptar, dicho en claro.
 *
 * `motivo` viene de la URL y no es de fiar: solo se aceptan los codigos de
 * RESULTADOS_ACEPTAR y el texto sale de ahi, nunca de la query. Lo peor que
 * logra alguien manipulandola es ver el mensaje generico.
 */
export default async function ResultadoInvitacionPage({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>
}) {
  const { motivo } = await searchParams
  const r = RESULTADOS_ACEPTAR[esMotivoAceptar(motivo) ? motivo : 'error']
  const conSalida = motivo === 'otro_correo' || motivo === 'otro_cliente'

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-surface-deepest)] p-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 text-center">
        <span
          aria-hidden
          className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--color-surface-base)]"
        >
          <Icon name="mail_lock" size={28} className="text-[var(--color-text-secondary)]" />
        </span>
        <h1 className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">{r.titulo}</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{r.texto}</p>

        <div className="mt-5 flex flex-col items-center gap-2">
          {conSalida ? (
            <form action="/auth/salir" method="post">
              <button
                type="submit"
                className="inline-flex h-11 items-center rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                Salir y entrar con otra cuenta
              </button>
            </form>
          ) : (
            <a
              href="/"
              className="inline-flex h-11 items-center rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              Ir al inicio
            </a>
          )}
        </div>
      </div>
    </main>
  )
}
