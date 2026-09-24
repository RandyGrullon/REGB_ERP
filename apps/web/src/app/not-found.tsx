'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@regb/ui'

/**
 * Lo que ve alguien que llega a una pantalla que no existe o que su rol no
 * puede abrir (las pantallas responden 404, no 403, para no confirmar que
 * existen).
 *
 * Antes no habia ninguna: Next pintaba "404 This page could not be found"
 * en negro y en ingles, sin forma de volver. Un cajero que tecleaba /roles
 * se quedaba ahi.
 */
export default function NoEncontrada() {
  // En demo el negocio y el rol viajan en la URL: el "volver" los conserva
  // para no soltar a la persona en otro negocio.
  const [inicio, setInicio] = useState('/')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const demo = new URLSearchParams()
    for (const k of ['tenant', 'rol']) {
      const v = q.get(k)
      if (v) demo.set(k, v)
    }
    const qs = demo.toString()
    setInicio(qs ? `/?${qs}` : '/')
  }, [])

  return (
    <div className="grid min-h-full place-items-center bg-[var(--color-surface-base)] p-6">
      <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-6 text-center">
        <Icon name="travel_explore" size={40} className="text-[var(--color-text-muted)]" />
        <h1 className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">
          No encontramos esta pantalla
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Puede que el enlace esté mal escrito, que el módulo no esté activo en tu negocio o que tu
          rol no tenga acceso. Si crees que deberías verla, pídesela a quien administra tu cuenta.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <a
            href={inicio}
            className="grid h-10 place-items-center rounded-[var(--radius-full)] bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Ir al inicio
          </a>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="h-10 rounded-[var(--radius-full)] border border-[var(--color-border)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Volver atrás
          </button>
        </div>
      </div>
    </div>
  )
}
