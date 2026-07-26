'use client'

import { useMemo, useState } from 'react'
import { Badge, Button, Card, cn } from '@regb/ui'
import { CATEGORIES, type CatalogEntry } from '@/lib/catalog'

/**
 * Marketplace (§12.3).
 *
 * El simulador de abajo es la pieza que vende: el cliente marca modulos y
 * ve, en vivo, cuanto sube su mensualidad y cuanto paga de instalacion.
 * Precio transparente como argumento de venta, no como riesgo (§6).
 */

const TIER_LABEL: Record<string, string> = {
  pyme: 'PYME',
  mediano: 'MEDIANO',
  grande: 'GRANDE',
}

const CATEGORY_TONE: Record<
  CatalogEntry['category'],
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

export function MarketplaceView({
  catalog,
  tier,
  tenantName,
  roleName,
  backHref,
}: {
  catalog: CatalogEntry[]
  tier: string
  tenantName: string
  roleName: string
  backHref: string
}) {
  const [filtro, setFiltro] = useState<string>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

  const activo = (m: CatalogEntry) => m.status === 'active' || m.status === 'trial'

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return catalog.filter((m) => {
      // Enterprise no se le ofrece a PYME ni a Mediano.
      if (m.category === 'enterprise' && tier !== 'grande') return false
      if (filtro !== 'todos' && m.category !== filtro) return false
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.includes(q)
      )
    })
  }, [catalog, filtro, busqueda, tier])

  const simulacion = useMemo(() => {
    const elegidos = catalog.filter((m) => seleccion.has(m.id))
    return {
      mensual: elegidos.reduce((s, m) => s + m.monthlyPrice, 0),
      instalacion: elegidos.reduce((s, m) => s + m.installPrice, 0),
      cuenta: elegidos.length,
    }
  }, [catalog, seleccion])

  const actual = useMemo(
    () => catalog.filter(activo).reduce((s, m) => s + m.monthlyPrice, 0),
    [catalog],
  )

  const toggle = (id: string) =>
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const disponibles = catalog.filter((m) => !activo(m) && m.isPublished).length
  const proximamente = catalog.filter((m) => !m.isPublished).length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4">
        <a
          href={backHref}
          className="rounded-[var(--radius-md)] px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          ← Volver
        </a>
        <span className="text-sm font-medium text-[var(--color-text-primary)]">🧩 Marketplace</span>
        <div className="flex-1" />
        <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">
          {tenantName} · {roleName}
        </span>
        <Badge tone="brand">{TIER_LABEL[tier] ?? tier}</Badge>
      </header>

      <div className="flex-1 overflow-y-auto p-4 pb-56 md:p-6 md:pb-48">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            Enciende lo que necesitas
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {catalog.filter(activo).length} activos · {disponibles} disponibles ahora ·{' '}
            {proximamente} en camino. Los precios que ves son los de tu plan{' '}
            <strong>{TIER_LABEL[tier] ?? tier}</strong>.
          </p>
        </div>

        {/* Filtros */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar modulo…"
            className="h-9 w-full max-w-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          />
          <Chip active={filtro === 'todos'} onClick={() => setFiltro('todos')}>
            Todos
          </Chip>
          {CATEGORIES.filter((c) => c.id !== 'enterprise' || tier === 'grande').map((c) => (
            <Chip key={c.id} active={filtro === c.id} onClick={() => setFiltro(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>

        {visibles.length === 0 ? (
          <p className="py-16 text-center text-sm text-[var(--color-text-muted)]">
            Nada coincide con &quot;{busqueda}&quot;.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibles.map((m) => (
              <ModuleCard
                key={m.id}
                mod={m}
                selected={seleccion.has(m.id)}
                onToggle={() => toggle(m.id)}
                detailHref={`/marketplace/${m.id}${backHref.includes('?') ? backHref.slice(backHref.indexOf('?')) : ''}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Simulador (§12.3) ─────────────────────────────────────────── */}
      <div className="absolute inset-x-0 bottom-0 border-t border-[var(--color-border)] bg-[var(--color-surface-deep)] p-4 shadow-[var(--shadow-lg)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4">
          <div className="flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              💵 Simulador de costo
            </p>
            {simulacion.cuenta === 0 ? (
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                Marca modulos arriba y calcula aqui lo que costarian. No se activa nada hasta que lo
                pidas.
              </p>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {simulacion.cuenta} modulo{simulacion.cuenta === 1 ? '' : 's'} seleccionado
                {simulacion.cuenta === 1 ? '' : 's'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-5">
            <Cifra label="Mensualidad actual" valor={`US$ ${money(actual)}`} />
            <Cifra
              label="Con lo seleccionado"
              valor={`US$ ${money(actual + simulacion.mensual)}`}
              delta={simulacion.mensual > 0 ? `+US$ ${money(simulacion.mensual)}` : undefined}
              destacado
            />
            <Cifra label="Instalacion unica" valor={`US$ ${money(simulacion.instalacion)}`} />
          </div>

          <div className="flex gap-2">
            {simulacion.cuenta > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSeleccion(new Set())}>
                Limpiar
              </Button>
            )}
            <Button size="sm" disabled={simulacion.cuenta === 0}>
              Solicitar activacion
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Cifra({
  label,
  valor,
  delta,
  destacado,
}: {
  label: string
  valor: string
  // `| undefined` explicito, no `?`: con exactOptionalPropertyTypes
  // "puede faltar" y "puede valer undefined" no son lo mismo.
  delta?: string | undefined
  destacado?: boolean | undefined
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p
        className={cn(
          'tabular text-lg font-bold',
          destacado ? 'text-[var(--color-brand-bright)]' : 'text-[var(--color-text-primary)]',
        )}
      >
        {valor}
        {delta && (
          <span className="ml-1.5 text-xs font-medium text-[var(--color-semantic-text-success)]">
            {delta}
          </span>
        )}
      </p>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-9 rounded-[var(--radius-md)] px-3 text-sm transition-colors duration-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
        active
          ? 'bg-[var(--color-brand)] font-medium text-[var(--color-text-on-brand)]'
          : 'bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
      )}
    >
      {children}
    </button>
  )
}

function ModuleCard({
  mod,
  selected,
  onToggle,
  detailHref,
}: {
  mod: CatalogEntry
  selected: boolean
  onToggle: () => void
  detailHref: string
}) {
  const activo = mod.status === 'active' || mod.status === 'trial'
  const esCore = mod.category === 'core'
  const seleccionable = !activo && !esCore && mod.isPublished

  const diasPrueba = mod.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(mod.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null

  return (
    <Card
      className={cn(
        'flex flex-col p-4 transition-colors duration-100',
        selected && 'ring-2 ring-[var(--color-brand-bright)]',
        !mod.isPublished && 'opacity-60',
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <a
          href={detailHref}
          className="flex-1 text-sm font-semibold text-[var(--color-text-primary)] underline-offset-2 hover:text-[var(--color-brand-bright)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          {mod.name}
        </a>
        <Badge tone={CATEGORY_TONE[mod.category]} dot={false}>
          {CATEGORIES.find((c) => c.id === mod.category)?.label ?? mod.category}
        </Badge>
      </div>

      <p className="mb-2 flex-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
        {mod.description}
      </p>

      <a
        href={detailHref}
        className="mb-3 text-xs text-[var(--color-text-link)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
      >
        Ver que incluye →
      </a>

      {/* Plataformas donde corre */}
      <p className="mb-2 text-[10px] text-[var(--color-text-muted)]">
        {[
          mod.platforms.web && 'Web',
          mod.platforms.desktop && 'Escritorio',
          mod.platforms.mobile && 'Movil',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {mod.missingRequires.length > 0 && (
        <p className="mb-2 text-[11px] text-[var(--color-semantic-text-warning)]">
          ⚠️ Necesita antes: {mod.missingRequires.join(', ')}
        </p>
      )}

      {/* Precio */}
      {esCore ? (
        <p className="mb-3 text-xs font-medium text-[var(--color-semantic-text-success)]">
          Incluido en tu plan
        </p>
      ) : (
        <div className="mb-3 space-y-0.5 text-xs">
          <div className="flex justify-between text-[var(--color-text-secondary)]">
            <span>Instalacion</span>
            <span className="tabular font-medium">US$ {money(mod.installPrice)}</span>
          </div>
          <div className="flex justify-between text-[var(--color-text-secondary)]">
            <span>Mensual</span>
            <span className="tabular font-medium text-[var(--color-text-primary)]">
              US$ {money(mod.monthlyPrice)}
            </span>
          </div>
        </div>
      )}

      {/* Estado / accion */}
      {activo ? (
        <div className="flex items-center gap-2">
          <Badge tone={mod.status === 'trial' ? 'brand' : 'success'}>
            {mod.status === 'trial' ? `Prueba · ${diasPrueba}d` : 'Activo'}
          </Badge>
          {!mod.enabled && <Badge tone="neutral">Apagado</Badge>}
        </div>
      ) : !mod.isPublished ? (
        <Badge tone="neutral">🚧 En camino</Badge>
      ) : esCore ? (
        <Badge tone="success">Disponible</Badge>
      ) : (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={!seleccionable}
            className="h-4 w-4 accent-[var(--color-brand)]"
          />
          Agregar al calculo
        </label>
      )}
    </Card>
  )
}
