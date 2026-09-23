'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { Button, Icon } from '@regb/ui'
import { BotonEnvio } from '@/components/BotonEnvio'
import { enlaceNuevoParaDueno } from './actions'

/**
 * El enlace de la invitacion del dueño existe UNA vez (0123 guarda solo su
 * hash), asi que se pinta aqui, en el resultado de la accion, y no en la
 * cookie de aviso. 'use client': hace falta el estado de la accion y el
 * portapapeles del navegador.
 */

export function EnlaceUnaVez({
  enlace,
  correo,
  vence,
}: {
  enlace: string
  correo: string
  vence: string | null
}) {
  const id = useId()
  const [copia, setCopia] = useState<'nada' | 'ok' | 'fallo'>('nada')

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace)
      setCopia('ok')
    } catch {
      setCopia('fallo')
    }
  }

  const venceTexto = vence
    ? new Date(vence).toLocaleDateString('es-DO', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-[var(--color-text-secondary)]">
        Enlace de invitacion para {correo}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          readOnly
          value={enlace}
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 font-[family-name:var(--font-mono)] text-xs text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={copiar}
          icon={<Icon name="content_copy" size={16} />}
        >
          Copiar enlace
        </Button>
      </div>
      <p role="status" className="min-h-4 text-xs text-[var(--color-text-secondary)]">
        {copia === 'ok'
          ? 'Copiado. Compartelo solo con el dueño: el enlace es su llave de entrada.'
          : copia === 'fallo'
            ? 'No pudimos copiarlo. Selecciona el enlace y copialo a mano.'
            : `Sirve una sola vez${venceTexto ? ` y vence el ${venceTexto}` : ''}. Si lo pierdes, genera uno nuevo: el anterior deja de servir.`}
      </p>
    </div>
  )
}

/** "Enlace nuevo para el dueño": rota el token y lo enseña una vez. */
export function EnlaceNuevoDueno({ clienteId, nombre }: { clienteId: string; nombre: string }) {
  const [estado, accion] = useActionState(enlaceNuevoParaDueno, null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [estado])

  return (
    <div className="space-y-2">
      <form action={accion}>
        <input type="hidden" name="clienteId" value={clienteId} />
        <BotonEnvio
          aria-label={`Generar un enlace nuevo para el dueño de ${nombre}`}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:opacity-50"
        >
          <Icon name="link" size={14} />
          Enlace nuevo para el dueño
        </BotonEnvio>
      </form>
      {estado && (
        <div
          ref={ref}
          tabIndex={-1}
          role={estado.ok ? 'status' : 'alert'}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-base)] p-3 focus-visible:outline-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          {estado.ok ? (
            <EnlaceUnaVez enlace={estado.enlace} correo={estado.correo} vence={estado.vence} />
          ) : (
            <p className="flex items-start gap-2 text-xs text-[var(--color-semantic-text-danger)]">
              <Icon name="error" size={16} />
              {estado.error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
