'use client'

import { useState } from 'react'
import { Button } from '@regb/ui'
import { createClient } from '@regb/sdk/browser'

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
            emailRedirectTo: `${window.location.origin}/auth/callback?siguiente=${nextPath}`,
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
      setError(
        /invalid login credentials/i.test(msg)
          ? 'El correo o la contraseña no coinciden. Si nunca has entrado, pide un enlace de acceso.'
          : /email not confirmed/i.test(msg)
            ? 'Todavía no confirmaste tu correo. Revisa tu bandeja o pide un enlace de acceso.'
            : msg,
      )
    } finally {
      setCargando(false)
    }
  }

  if (enviado) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-center">
        <p className="text-3xl" aria-hidden>
          📬
        </p>
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
