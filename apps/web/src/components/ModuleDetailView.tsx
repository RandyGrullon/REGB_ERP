'use client'

import { useState } from 'react'
import { Badge, Button, Card, cn } from '@regb/ui'
import { CATEGORIES, type ModuleDetail } from '@/lib/catalog'

/**
 * Ficha de un modulo.
 *
 * El orden es el de una conversacion de venta, no el de una tabla de la
 * base: primero el dolor, luego lo que trae, luego como se ve, y solo al
 * final el precio. Quien llega hasta abajo ya sabe si lo quiere.
 */

const TIER_LABEL: Record<string, string> = {
  pyme: 'PYME',
  mediano: 'MEDIANO',
  grande: 'GRANDE',
}

const CATEGORY_TONE: Record<
  ModuleDetail['category'],
  'success' | 'brand' | 'info' | 'warning' | 'danger'
> = {
  core: 'success',
  standard: 'brand',
  advanced: 'info',
  vertical: 'warning',
  enterprise: 'danger',
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export function ModuleDetailView({
  mod,
  tier,
  backHref,
}: {
  mod: ModuleDetail
  tier: string
  backHref: string
}) {
  const [pantalla, setPantalla] = useState(0)
  const activo = mod.status === 'active' || mod.status === 'trial'
  const esCore = mod.category === 'core'

  const diasPrueba = mod.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(mod.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4">
        <a
          href={backHref}
          className="rounded-[var(--radius-md)] px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          ← Marketplace
        </a>
        <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
          {mod.name}
        </span>
        <div className="flex-1" />
        <Badge tone={CATEGORY_TONE[mod.category]} dot={false}>
          {CATEGORIES.find((c) => c.id === mod.category)?.label ?? mod.category}
        </Badge>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-4 md:p-8">
          {/* ── El dolor que quita ────────────────────────────────── */}
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">
            {mod.name}
          </h1>
          <p className="mt-2 text-lg text-[var(--color-text-secondary)]">{mod.tagline}</p>

          {mod.problem && (
            <div className="mt-5 rounded-[var(--radius-lg)] border-l-[3px] border-[var(--color-brand-bright)] bg-[var(--color-surface-raised)] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                El problema
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                {mod.problem}
              </p>
            </div>
          )}

          {/* ── Estado actual ─────────────────────────────────────── */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {activo ? (
              <Badge tone={mod.status === 'trial' ? 'brand' : 'success'}>
                {mod.status === 'trial' ? `En prueba · ${diasPrueba} dias` : 'Activo en tu cuenta'}
              </Badge>
            ) : !mod.isPublished ? (
              <Badge tone="neutral">🚧 Todavia no esta construido</Badge>
            ) : esCore ? (
              <Badge tone="success">Incluido en tu plan</Badge>
            ) : (
              <Badge tone="neutral">Disponible</Badge>
            )}

            {mod.setupMinutes && (
              <span className="text-xs text-[var(--color-text-muted)]">
                ⏱️ Se configura en ~{mod.setupMinutes} minutos
              </span>
            )}
          </div>

          {mod.missingRequires.length > 0 && (
            <p className="mt-3 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_15%,transparent)] px-3 py-2 text-sm text-[var(--color-semantic-text-warning)]">
              ⚠️ Antes necesitas activar: <strong>{mod.missingRequires.join(', ')}</strong>
            </p>
          )}

          {/* ── Que trae ──────────────────────────────────────────── */}
          {mod.features.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                Que incluye
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {mod.features.map((f) => (
                  <Card key={f.titulo} className="p-4">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {f.titulo}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                      {f.detalle}
                    </p>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* ── Como se ve ────────────────────────────────────────── */}
          {mod.screens.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Como se ve</h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Mockups de las pantallas reales. Son esquemas y no capturas: una captura envejece
                con cada cambio y nadie la actualiza.
              </p>

              {mod.screens.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {mod.screens.map((s, i) => (
                    <button
                      key={s.titulo}
                      type="button"
                      onClick={() => setPantalla(i)}
                      aria-pressed={i === pantalla}
                      className={cn(
                        'h-8 rounded-[var(--radius-md)] px-3 text-xs transition-colors duration-100',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
                        i === pantalla
                          ? 'bg-[var(--color-brand)] font-medium text-[var(--color-text-on-brand)]'
                          : 'bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                      )}
                    >
                      {s.titulo}
                    </button>
                  ))}
                </div>
              )}

              {mod.screens[pantalla] && (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-[var(--color-text-secondary)]">
                    {mod.screens[pantalla].descripcion}
                  </p>
                  <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-deepest)] p-4">
                    <pre className="font-[family-name:var(--font-mono)] text-[11px] leading-[1.5] text-[var(--color-text-secondary)] md:text-xs">
                      {mod.screens[pantalla].mockup}
                    </pre>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── A quien le sirve ──────────────────────────────────── */}
          {mod.audience.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                A quien le sirve
              </h2>
              <ul className="mt-3 space-y-1.5">
                {mod.audience.map((a) => (
                  <li key={a} className="flex gap-2 text-sm text-[var(--color-text-secondary)]">
                    <span className="text-[var(--color-semantic-text-success)]" aria-hidden>
                      ✓
                    </span>
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Donde corre ───────────────────────────────────────── */}
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Donde corre</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(
                [
                  ['web', '🌐 Navegador', 'Desde cualquier computadora'],
                  ['desktop', '🖥️ Escritorio', 'App instalada, funciona sin internet'],
                  ['mobile', '📱 Celular', 'Android y iPhone'],
                ] as const
              ).map(([k, titulo, detalle]) => {
                const soportado = mod.platforms[k]
                return (
                  <div
                    key={k}
                    className={cn(
                      'rounded-[var(--radius-md)] border px-3 py-2',
                      soportado
                        ? 'border-[var(--color-border)] bg-[var(--color-surface-raised)]'
                        : 'border-dashed border-[var(--color-border)] opacity-50',
                    )}
                  >
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{titulo}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      {soportado ? detalle : 'No disponible en esta plataforma'}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── Preguntas ─────────────────────────────────────────── */}
          {mod.faq.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                Preguntas frecuentes
              </h2>
              <div className="mt-3 space-y-2">
                {mod.faq.map((f) => (
                  <details
                    key={f.p}
                    className="group rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)]"
                  >
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--color-text-primary)] marker:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                      <span
                        aria-hidden
                        className="mr-2 inline-block transition-transform group-open:rotate-90"
                      >
                        ›
                      </span>
                      {f.p}
                    </summary>
                    <p className="px-4 pb-3 pl-9 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                      {f.r}
                    </p>
                  </details>
                ))}
              </div>
            </section>
          )}

          <div className="h-36" />
        </div>
      </div>

      {/* ── Precio, pegado abajo ────────────────────────────────── */}
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-deep)] px-4 py-3 shadow-[var(--shadow-lg)]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-4">
          {esCore ? (
            <p className="flex-1 text-sm font-medium text-[var(--color-semantic-text-success)]">
              Incluido en tu plan {TIER_LABEL[tier] ?? tier} — no cuesta aparte.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Mensual
                  </p>
                  <p className="tabular text-xl font-bold text-[var(--color-text-primary)]">
                    US$ {money(mod.monthlyPrice)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                    Instalacion
                  </p>
                  <p className="tabular text-xl font-bold text-[var(--color-text-primary)]">
                    US$ {money(mod.installPrice)}
                  </p>
                </div>
                {mod.metered && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                      Por uso
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {mod.metered.included} {mod.metered.key}s incluidos, luego US$
                      {mod.metered.price} c/u
                    </p>
                  </div>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                Precio de tu plan {TIER_LABEL[tier] ?? tier}
              </p>
            </>
          )}

          <div className="flex-1" />

          {activo ? (
            <Badge tone="success">Ya lo tienes</Badge>
          ) : !mod.isPublished ? (
            <Button size="sm" variant="secondary" disabled>
              Avisame cuando este
            </Button>
          ) : esCore ? null : (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary">
                Probar 14 dias
              </Button>
              <Button size="sm" disabled={mod.missingRequires.length > 0}>
                Solicitar activacion
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
