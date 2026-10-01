import { notFound, redirect } from 'next/navigation'
import { Icon } from '@regb/ui'
import { authConfigured } from '@/lib/supabase'

export const metadata = { title: 'Invitación · REGB ERP' }
export const dynamic = 'force-dynamic'

const TOKEN = /^[0-9a-f]{64}$/

/**
 * Quien abre una invitacion SIN sesion llega aqui.
 *
 * Antes se le mandaba al login, y eso dejaba fuera justo al primero que la
 * abre: el dueño que sale del alta de REGB Control. No tiene cuenta, el
 * registro esta cerrado (solo por invitacion) y el enlace de acceso solo
 * sale para cuentas que ya existen. Se quedaba en el login sin salida.
 *
 * Aqui se le ofrece que le mandemos el correo de la invitacion a SU
 * direccion -la de la invitacion, no una que escriba-: abrir ese correo es
 * lo que prueba quien es y abre la sesion. Con un boton y no al abrir la
 * pagina: la vista previa de WhatsApp tambien "abre" el enlace, y no debe
 * mandar correos.
 *
 * `aviso` viene de la URL y no es de fiar: solo se muestran los textos de
 * AVISOS, nunca lo que traiga la query.
 */
const AVISOS = {
  enviado: {
    tono: 'ok',
    texto:
      'Listo. Te mandamos un correo a la dirección de la invitación. Ábrelo y toca «Aceptar la invitación»: con eso entras. Si no llega en unos minutos, revisa el spam.',
  },
  espera: {
    tono: 'aviso',
    texto:
      'Ya te mandamos ese correo hace un momento. Revisa tu bandeja (y el spam) antes de pedir otro.',
  },
  enlace_usado: {
    tono: 'aviso',
    texto:
      'El enlace del correo ya se usó o caducó: cada uno sirve una sola vez. Pide otro con el botón.',
  },
  fallo: {
    tono: 'error',
    texto:
      'No pudimos mandar el correo. Intenta de nuevo en unos minutos; si sigue igual, pídele a quien te invitó que te lo reenvíe.',
  },
} as const

type Aviso = keyof typeof AVISOS
const esAviso = (a: string | undefined): a is Aviso =>
  a !== undefined && Object.prototype.hasOwnProperty.call(AVISOS, a)

const COLOR = {
  ok: 'text-[var(--color-semantic-text-success)]',
  aviso: 'text-[var(--color-semantic-text-warning)]',
  error: 'text-[var(--color-semantic-text-danger)]',
} as const

export default async function EntrarConInvitacionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ aviso?: string }>
}) {
  const { token } = await params
  const { aviso } = await searchParams
  if (!TOKEN.test(token)) notFound()
  if (!authConfigured) redirect('/auth/invitacion/resultado?motivo=demo')

  const a = esAviso(aviso) ? AVISOS[aviso] : null
  const volver = `/auth/invitacion/${token}`

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-surface-deepest)] p-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 text-center">
        <span
          aria-hidden
          className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--color-surface-base)]"
        >
          <Icon name="mail" size={28} className="text-[var(--color-text-secondary)]" />
        </span>
        <h1 className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">
          Te invitaron a REGB ERP
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Para aceptar, confirma que eres tú: te mandamos un correo a la dirección de la invitación
          y con abrirlo quedas dentro. No necesitas contraseña.
        </p>

        {a && (
          <p role="status" className={`mt-4 text-sm ${COLOR[a.tono]}`}>
            {a.texto}
          </p>
        )}

        <form action={`/auth/invitacion/${token}/correo`} method="post" className="mt-5">
          <button
            type="submit"
            className="inline-flex h-11 items-center rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            {aviso === 'enviado' ? 'Mandármelo otra vez' : 'Mandarme el correo para entrar'}
          </button>
        </form>

        <a
          href={`/login?siguiente=${encodeURIComponent(volver)}`}
          className="mt-4 inline-block text-sm text-[var(--color-text-link)] underline-offset-4 hover:underline"
        >
          Ya tengo cuenta: entrar con mi correo
        </a>
      </div>
    </main>
  )
}
