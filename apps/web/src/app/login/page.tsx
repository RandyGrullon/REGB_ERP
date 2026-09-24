import { LoginForm } from '@/components/LoginForm'
import { authConfigured } from '@/lib/supabase'

export const metadata = { title: 'Entrar · REGB ERP' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ siguiente?: string; error?: string }>
}) {
  const params = await searchParams

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-surface-deepest)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-brand)] text-2xl">
            🛰️
          </div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">REGB ERP</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Entra con el correo de tu empresa
          </p>
        </div>

        {authConfigured ? (
          <LoginForm nextPath={params.siguiente ?? '/'} initialError={params.error} />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
            <p className="text-sm font-medium text-[var(--color-semantic-text-warning)]">
              Modo demostración
            </p>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              No hay un Supabase configurado, así que el login esta desactivado y la app usa una
              sesión simulada.
            </p>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Para activarlo, copia{' '}
              <code className="font-[family-name:var(--font-mono)]">.env.example</code> a{' '}
              <code className="font-[family-name:var(--font-mono)]">.env.local</code> con la URL y
              la clave anonima de tu proyecto.
            </p>
            <a
              href="/"
              className="mt-4 inline-block text-sm text-[var(--color-text-link)] underline-offset-4 hover:underline"
            >
              Entrar en modo demostración →
            </a>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-[var(--color-text-muted)]">
          REGB no permite registro libre. Tu administrador te invita.
        </p>
      </div>
    </main>
  )
}
