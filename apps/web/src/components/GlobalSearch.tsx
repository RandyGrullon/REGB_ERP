'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@regb/ui'

/**
 * Busqueda global — Ctrl+K (S10, puerta F2).
 *
 * Encuentra modulos, registros, acciones y articulos del tutorial. El
 * indice llega YA FILTRADO del servidor: solo contiene lo que este rol
 * puede ver, asi que la busqueda no filtra informacion por el buscador.
 */

export interface SearchEntry {
  type: 'modulo' | 'registro' | 'accion' | 'ayuda'
  label: string
  detail?: string
  path: string
  keywords?: string
}

const TYPE_LABEL: Record<SearchEntry['type'], string> = {
  modulo: 'Modulo',
  registro: 'Registro',
  accion: 'Accion',
  ayuda: 'Ayuda',
}

function normaliza(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function GlobalSearch({ index, qs }: { index: SearchEntry[]; qs: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
        setQuery('')
        setCursor(0)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const results = useMemo(() => {
    const q = normaliza(query.trim())
    if (!q) return index.slice(0, 8)
    return index
      .filter((e) => normaliza(`${e.label} ${e.detail ?? ''} ${e.keywords ?? ''}`).includes(q))
      .slice(0, 10)
  }, [index, query])

  const irA = useCallback(
    (entry: SearchEntry) => {
      setOpen(false)
      window.location.href = entry.path + qs
    },
    [qs],
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 min-w-56 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] pl-2.5 pr-2 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] sm:flex"
      >
        <Icon name="search" size={18} />
        <span className="flex-1 text-left">Buscar…</span>
        <kbd className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px]">
          Ctrl K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Busqueda global"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4">
              <Icon name="search" size={20} className="shrink-0 text-[var(--color-text-muted)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setCursor(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setCursor((c) => Math.min(c + 1, results.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setCursor((c) => Math.max(c - 1, 0))
                  } else if (e.key === 'Enter' && results[cursor]) {
                    irA(results[cursor])
                  }
                }}
                placeholder="Modulos, registros, acciones, ayuda…"
                className="h-12 w-full bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
              />
              <kbd className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-text-muted)]">
                Esc
              </kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="Resultados">
              {results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">
                  Nada con &quot;{query}&quot;. Prueba con el nombre de un modulo o un producto.
                </li>
              )}
              {results.map((r, i) => (
                <li
                  key={`${r.type}-${r.path}-${r.label}`}
                  role="option"
                  aria-selected={i === cursor}
                >
                  <button
                    type="button"
                    onClick={() => irA(r)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left text-sm ${
                      i === cursor
                        ? 'bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)]'
                    }`}
                  >
                    <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                      {TYPE_LABEL[r.type]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.label}</span>
                      {r.detail && (
                        <span className="block truncate text-xs text-[var(--color-text-muted)]">
                          {r.detail}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
