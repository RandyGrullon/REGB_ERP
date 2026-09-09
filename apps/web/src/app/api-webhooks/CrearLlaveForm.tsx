'use client'

import { useActionState } from 'react'
import { crearLlave } from './actions'
import { SCOPES_DISPONIBLES, SCOPE_LABEL } from './estados'

/** Formulario para crear una llave de API -es la unica pantalla que la muestra completa-. */
export function CrearLlaveForm({ tenant, rol }: { tenant: string; rol: string }) {
  const [estado, accion, enviando] = useActionState(crearLlave, null)

  return (
    <div className="space-y-3">
      {estado?.ok && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3">
          <p className="text-xs font-medium text-[var(--color-semantic-text-success)]">
            Copia esta llave ahora -no la volveras a ver completa-.
          </p>
          <p className="mt-1 break-all font-mono text-xs text-[var(--color-text-primary)]">{estado.key}</p>
        </div>
      )}
      {estado && !estado.ok && <p className="text-xs text-[var(--color-semantic-text-danger)]">{estado.error}</p>}

      <form action={accion} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tenant" value={tenant} />
        <input type="hidden" name="rol" value={rol} />
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Nombre
          <input
            name="name"
            required
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
          />
        </label>
        <fieldset className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Permisos
          <div className="flex gap-3">
            {SCOPES_DISPONIBLES.map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input type="checkbox" name="scopes" value={s} defaultChecked={s === 'read'} />
                {SCOPE_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          Limite por minuto
          <input
            name="rateLimit"
            type="number"
            defaultValue={60}
            min={1}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
          />
        </label>
        <button
          type="submit"
          disabled={enviando}
          className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] disabled:opacity-60"
        >
          Crear llave
        </button>
      </form>
    </div>
  )
}
