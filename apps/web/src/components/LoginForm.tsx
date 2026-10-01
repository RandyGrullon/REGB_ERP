'use client'

import { useState } from 'react'
import { Button, Icon } from '@regb/ui'
import { createClient } from '@regb/sdk/browser'

/**
 * Lo que dice Supabase, en español y con qué hacer (§11.7). Supabase
 * responde en inglés; un cajero no tiene por qué entender "rate limit".
 */
function mensajeDeError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) {
    return 'El correo o la contraseña no coinciden. Si nunca has entrado, pide un enlace de acceso.'
  }
  if (/email not confirmed/i.test(msg)) {
    return 'Todavía no confirmaste tu correo. Revisa tu bandeja o pide un enlace de acceso.'
  }
  if (/signups? not allowed|user not found/i.test(msg)) {
    return 'Ese correo no tiene cuenta en REGB. Pídele a tu administrador que te invite desde Usuarios.'
  }
  if (/rate limit|too many requests|security purposes/i.test(msg)) {
    return 'Pediste demasiados enlaces seguidos. Espera un minuto y vuelve a intentarlo.'
  }
  if (/failed to fetch|network/i.test(msg)) {
    return 'No pudimos hablar con el servidor de acceso. Revisa tu conexión y vuelve a intentarlo.'
  }
  return msg
}

/**
 * Formulario de entrada.
 *
 * Dos vias: contrasena y enlace magico. El enlace magico es el que de
 * verdad usa la gente en un colmado — nadie recuerda una contrasena que
 * usa dos veces al mes.
 */
export function LoginForm({
  nextPath,
  initialError,
}: {
  nextPath: string
  initialError?: string | undefined
}) {
  const [modo, setModo] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [enviado, setEnviado] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError(null)

    try {
      const supabase = createClient()

      if (modo === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: {
            // `siguiente` codificado: una ruta con `?` o `&` (la de una
            // invitacion con parametros) rompia la URL de vuelta.
            emailRedirectTo: `${window.location.origin}/auth/callback?siguiente=${encodeURIComponent(nextPath)}`,
            // REGB no tiene registro libre: el enlace solo sale para quien
            // ya tiene cuenta. Sin esto Supabase intentaria crear la cuenta
            // y responderia en ingles "Signups not allowed for otp".
            shouldCreateUser: false,
          },
        })
        if (error) throw error
        setEnviado(true)
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) throw error

      // Recarga completa para que el middleware vea la cookie nueva.
      window.location.href = nextPath
    } catch (err) {
      // Mensaje util, no un codigo: que paso, por que, que hacer (§11.7).
      const msg = err instanceof Error ? err.message : String(err)
      setError(mensajeDeError(msg))
    } finally {
      setCargando(false)
    }
  }

  if (enviado) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-center">
        <span
          aria-hidden
          className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--color-surface-base)]"
        >
          <Icon name="mark_email_unread" size={26} className="text-[var(--color-text-secondary)]" />
        </span>
        <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
          Te mandamos un enlace
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Abre <strong>{email}</strong> y toca el enlace. Caduca en una hora.
        </p>
        <button
          type="button"
          onClick={() => setEnviado(false)}
          className="mt-3 text-xs text-[var(--color-text-link)] underline-offset-4 hover:underline"
        >
          Usar otro correo
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={entrar}
      className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
    >
      <div>
        <label
          htmlFor="email"
          className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
        >
          Correo
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="maria@tuempresa.do"
          className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        />
      </div>

      {modo === 'password' && (
        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
          >
            Contrasena
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          />
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-semantic-danger)_15%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-danger)]"
        >
          {error}
        </p>
      )}

      <Button type="submit" loading={cargando} className="w-full">
        {modo === 'magic' ? 'Mandarme un enlace' : 'Entrar'}
      </Button>

      <button
        type="button"
        onClick={() => {
          setModo((m) => (m === 'password' ? 'magic' : 'password'))
          setError(null)
        }}
        className="w-full text-center text-xs text-[var(--color-text-link)] underline-offset-4 hover:underline"
      >
        {modo === 'password'
          ? 'No recuerdo mi contraseña — mandame un enlace'
          : 'Prefiero usar mi contraseña'}
      </button>
    </form>
  )
}
