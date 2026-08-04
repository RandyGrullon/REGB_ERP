'use client'

import { useMemo, useState } from 'react'
import { Badge, Button, Card, Icon, cn } from '@regb/ui'
import { CATEGORIES, type CatalogEntry } from '@/lib/catalog'

/**
 * Marketplace (§12.3).
 *
 * Vende sin mentir. Tres reglas que se notan en cada decision de esta
 * pantalla:
 *
 *  1. **Nada se activa por sorpresa.** El simulador calcula, no compra.
 *  2. **Las dependencias se resuelven solas.** Marcar `ar` sin
 *     `sales-orders` es comprar algo que no va a funcionar; aqui se
 *     agregan las que faltan y se dice cuales fueron.
 *  3. **El precio que se enseña es el que se cobra.** Del tier del cliente
 *     que mira, calculado por el mismo motor que emite la factura.
 */

const TIER_LABEL: Record<string, string> = { pyme: 'PYME', mediano: 'MEDIANO', grande: 'GRANDE' }

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

/** El mismo que aplica `@regb/billing` al ciclo anual. */
const DESCUENTO_ANUAL = 0.15

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

type Orden = 'recomendado' | 'precio-asc' | 'precio-desc' | 'nombre'

/**
 * Paquetes por tipo de negocio.
 *
 * Un dueno de colmado no sabe si necesita "standard" o "advanced": sabe
 * que vende en mostrador y que le fia a dos clientes. Esto traduce lo
 * segundo en lo primero, que es la unica forma de que el catalogo le sirva
 * a quien paga y no solo a quien lo construyo.
 */
const PAQUETES: { id: string; nombre: string; icono: string; para: string; modulos: string[] }[] = [
  {
    id: 'mostrador',
    nombre: 'Vendo en mostrador',
    icono: 'storefront',
    para: 'Colmado, farmacia, cafeteria',
    modulos: ['products', 'inventory', 'pos'],
  },
  {
    id: 'credito',
    nombre: 'Vendo a credito',
    icono: 'receipt_long',
    para: 'Ferreteria, distribuidora',
    modulos: ['products', 'inventory', 'sales-orders', 'ar'],
  },
  {
    id: 'completo',
    nombre: 'El ciclo completo',
    icono: 'account_tree',
    para: 'Vender, cobrar y declarar',
    modulos: ['products', 'inventory', 'sales-orders', 'pos', 'ar'],
  },
]

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
  const [orden, setOrden] = useState<Orden>('recomendado')
  const [soloDisponibles, setSoloDisponibles] = useState(false)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [ultimoPaquete, setUltimoPaquete] = useState<string | null>(null)

  const activo = (m: CatalogEntry) => m.status === 'active' || m.status === 'trial'
  const porId = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog])

  /**
   * Cierra la seleccion con sus dependencias.
   *
   * Es la pieza que evita la peor venta posible: cobrarle a alguien un
   * modulo que no va a poder usar. Se recorre en anchura porque una
   * dependencia puede arrastrar la suya.
   */
  const { seleccionReal, dependenciasAnadidas } = useMemo(() => {
    const total = new Set(seleccion)
    const anadidos: string[] = []
    const cola = [...seleccion]
    while (cola.length > 0) {
      const m = porId.get(cola.shift()!)
      if (!m) continue
      for (const req of m.requires) {
        const dep = porId.get(req)
        // Lo que ya esta activo no hay que volver a comprarlo.
        if (!dep || total.has(req) || dep.status === 'active' || dep.status === 'trial') continue
        total.add(req)
        anadidos.push(req)
        cola.push(req)
      }
    }
    return { seleccionReal: total, dependenciasAnadidas: anadidos }
  }, [seleccion, porId])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const lista = catalog.filter((m) => {
      if (m.category === 'enterprise' && tier !== 'grande') return false
      if (filtro !== 'todos' && m.category !== filtro) return false
      if (soloDisponibles && (!m.isPublished || activo(m))) return false
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.includes(q)
      )
    })

    return [...lista].sort((a, b) => {
      if (orden === 'nombre') return a.name.localeCompare(b.name)
      if (orden === 'precio-asc') return a.monthlyPrice - b.monthlyPrice
      if (orden === 'precio-desc') return b.monthlyPrice - a.monthlyPrice
      // Recomendado: lo que se puede encender hoy primero, lo que ya se
      // tiene despues, y lo que todavia no existe al final.
      const peso = (m: CatalogEntry) =>
        !m.isPublished ? 3 : activo(m) ? 2 : m.missingRequires.length > 0 ? 1 : 0
      return peso(a) - peso(b) || a.name.localeCompare(b.name)
    })
  }, [catalog, filtro, busqueda, tier, orden, soloDisponibles])

  const simulacion = useMemo(() => {
    const elegidos = catalog.filter((m) => seleccionReal.has(m.id))
    const mensual = elegidos.reduce((s, m) => s + m.monthlyPrice, 0)
    return {
      mensual,
      instalacion: elegidos.reduce((s, m) => s + m.installPrice, 0),
      cuenta: elegidos.length,
      ahorroAnual: mensual * 12 * DESCUENTO_ANUAL,
    }
  }, [catalog, seleccionReal])

  const actual = useMemo(
    () => catalog.filter(activo).reduce((s, m) => s + m.monthlyPrice, 0),
    [catalog],
  )

  const toggle = (id: string) => {
    setUltimoPaquete(null)
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const faltantesDe = (modulos: string[]) =>
    modulos.filter((id) => {
      const m = porId.get(id)
      return m && !activo(m) && m.isPublished
    })

  const activos = catalog.filter(activo)
  const disponibles = catalog.filter((m) => !activo(m) && m.isPublished).length
  const proximamente = catalog.filter((m) => !m.isPublished).length
  const enPrueba = activos.filter((m) => m.status === 'trial')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4">
        <a
          href={backHref}
          className="flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          <Icon name="arrow_back" size={18} />
          Volver
        </a>
        <span className="text-sm font-medium text-[var(--color-text-primary)]">Marketplace</span>
        <div className="flex-1" />
        <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">
          {tenantName} · {roleName}
        </span>
        <Badge tone="brand">{TIER_LABEL[tier] ?? tier}</Badge>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-64 md:p-6 md:pb-56">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            Enciende lo que necesitas
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {activos.length} activos · {disponibles} para encender hoy · {proximamente} en camino.
            Los precios son los de tu plan <strong>{TIER_LABEL[tier] ?? tier}</strong>, calculados
            por el mismo motor que emite tu factura.
          </p>
        </div>

        {enPrueba.length > 0 && (
          <div
            role="note"
            className="mb-4 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] p-3 text-sm"
          >
            <Icon
              name="schedule"
              size={20}
              filled
              className="shrink-0 text-[var(--color-semantic-text-warning)]"
            />
            <p className="text-[var(--color-text-secondary)]">
              Tienes {enPrueba.length} modulo{enPrueba.length === 1 ? '' : 's'} en prueba:{' '}
              <strong className="text-[var(--color-text-primary)]">
                {enPrueba.map((m) => m.name).join(', ')}
              </strong>
              . Al terminar dejan de verse, pero{' '}
              <strong className="text-[var(--color-text-primary)]">tus datos se quedan</strong> por
              si los reactivas.
            </p>
          </div>
        )}

        {/* Traduce "que vendo" en "que activo". */}
        <section aria-label="Por tipo de negocio" className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            ¿No sabes por donde empezar?
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PAQUETES.map((p) => {
              const faltan = faltantesDe(p.modulos)
              const yaLoTiene = faltan.length === 0
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSeleccion(new Set(faltan))
                    setUltimoPaquete(p.id)
                  }}
                  disabled={yaLoTiene}
                  className={cn(
                    'flex items-start gap-2 rounded-[var(--radius-lg)] border p-3 text-left transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]',
                    ultimoPaquete === p.id
                      ? 'border-[var(--color-brand-bright)] bg-[var(--color-brand-soft)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface-raised)] hover:border-[var(--color-border-strong)]',
                    yaLoTiene && 'opacity-60',
                  )}
                >
                  <Icon
                    name={p.icono}
                    size={22}
                    className="mt-0.5 shrink-0 text-[var(--color-brand-bright)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                      {p.nombre}
                    </span>
                    <span className="block text-xs text-[var(--color-text-muted)]">{p.para}</span>
                    <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                      {yaLoTiene ? 'Ya lo tienes completo' : `Te faltan ${faltan.length}`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="relative flex items-center">
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute left-2.5 text-[var(--color-text-muted)]"
            />
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar modulo…"
              aria-label="Buscar modulo"
              className="h-9 w-full max-w-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] pl-9 pr-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            />
          </span>
          <Chip active={filtro === 'todos'} onClick={() => setFiltro('todos')}>
            Todos
          </Chip>
          {CATEGORIES.filter((c) => c.id !== 'enterprise' || tier === 'grande').map((c) => (
            <Chip key={c.id} active={filtro === c.id} onClick={() => setFiltro(c.id)}>
              {c.label}
            </Chip>
          ))}

          <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={soloDisponibles}
              onChange={(e) => setSoloDisponibles(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-brand)]"
            />
            Solo lo que puedo encender hoy
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            Orden
            <select
              value={orden}
              onChange={(e) => setOrden(e.target.value as Orden)}
              aria-label="Ordenar modulos"
              className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <option value="recomendado">Recomendado</option>
              <option value="precio-asc">Mas barato</option>
              <option value="precio-desc">Mas caro</option>
              <option value="nombre">Nombre</option>
            </select>
          </label>
        </div>

        {visibles.length === 0 ? (
          <div className="py-16 text-center">
            <Icon name="search_off" size={40} className="text-[var(--color-text-muted)]" />
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Nada coincide con esos filtros.
            </p>
            <button
              type="button"
              onClick={() => {
                setBusqueda('')
                setFiltro('todos')
                setSoloDisponibles(false)
              }}
              className="mt-2 text-sm text-[var(--color-text-link)] hover:underline"
            >
              Limpiar filtros
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibles.map((m) => (
              <ModuleCard
                key={m.id}
                mod={m}
                selected={seleccion.has(m.id)}
                arrastrado={seleccionReal.has(m.id) && !seleccion.has(m.id)}
                onToggle={() => toggle(m.id)}
                detailHref={`/marketplace/${m.id}${backHref.includes('?') ? backHref.slice(backHref.indexOf('?')) : ''}`}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Simulador (§12.3) ─────────────────────────────────────────── */}
      <div className="absolute inset-x-0 bottom-0 border-t border-[var(--color-border)] bg-[var(--color-surface-deep)] p-4 shadow-[var(--shadow-lg)]">
        <div className="mx-auto max-w-5xl space-y-2">
          {dependenciasAnadidas.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-[var(--color-semantic-text-warning)]">
              <Icon name="link" size={16} className="mt-px shrink-0" />
              <span>
                Se agregaron solos{' '}
                <strong>
                  {dependenciasAnadidas.map((id) => porId.get(id)?.name ?? id).join(', ')}
                </strong>
                : sin ellos lo que marcaste no funciona, y van incluidos en el calculo.
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1">
              <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                <Icon name="calculate" size={14} />
                Simulador de costo
              </p>
              {simulacion.cuenta === 0 ? (
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Marca modulos arriba y calcula lo que costarian.{' '}
                  <strong className="text-[var(--color-text-primary)]">
                    No se activa nada hasta que lo pidas.
                  </strong>
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  {simulacion.cuenta} modulo{simulacion.cuenta === 1 ? '' : 's'}
                  {simulacion.ahorroAnual > 0 && (
                    <>
                      {' · '}
                      <span className="text-[var(--color-semantic-text-success)]">
                        pagando anual te ahorras US$ {money(simulacion.ahorroAnual)} al ano
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-5">
              <Cifra label="Pagas hoy" valor={`US$ ${money(actual)}`} />
              <Cifra
                label="Pasarias a pagar"
                valor={`US$ ${money(actual + simulacion.mensual)}`}
                delta={simulacion.mensual > 0 ? `+US$ ${money(simulacion.mensual)}` : undefined}
                destacado
              />
              <Cifra label="Instalacion, una vez" valor={`US$ ${money(simulacion.instalacion)}`} />
            </div>

            <div className="flex gap-2">
              {simulacion.cuenta > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSeleccion(new Set())
                    setUltimoPaquete(null)
                  }}
                >
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
  arrastrado,
  onToggle,
  detailHref,
}: {
  mod: CatalogEntry
  selected: boolean
  /** Entro al calculo porque otro lo necesita, no porque se marcara. */
  arrastrado: boolean
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
        arrastrado && 'ring-2 ring-[var(--color-semantic-warning)]',
        !mod.isPublished && 'opacity-60',
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <Icon
          name={mod.icon}
          size={20}
          className="mt-0.5 shrink-0 text-[var(--color-brand-bright)]"
        />
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
        className="mb-3 flex items-center gap-0.5 text-xs text-[var(--color-text-link)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
      >
        Ver que incluye
        <Icon name="arrow_forward" size={14} />
      </a>

      {/* Donde corre. Ahora importa de verdad: la app de escritorio existe. */}
      <p className="mb-2 flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
        {mod.platforms.web && (
          <span className="flex items-center gap-0.5">
            <Icon name="language" size={12} /> Web
          </span>
        )}
        {mod.platforms.desktop && (
          <span className="flex items-center gap-0.5">
            <Icon name="desktop_windows" size={12} /> Escritorio
          </span>
        )}
        {mod.platforms.mobile && (
          <span className="flex items-center gap-0.5">
            <Icon name="smartphone" size={12} /> Movil
          </span>
        )}
      </p>

      {mod.missingRequires.length > 0 && !activo && (
        <p className="mb-2 flex items-start gap-1 text-[11px] text-[var(--color-semantic-text-warning)]">
          <Icon name="link" size={14} className="mt-px shrink-0" />
          Necesita {mod.missingRequires.join(', ')} — se agrega solo al marcarlo
        </p>
      )}

      {esCore ? (
        <p className="mb-3 flex items-center gap-1 text-xs font-medium text-[var(--color-semantic-text-success)]">
          <Icon name="check_circle" size={14} filled />
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

      {activo ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={mod.status === 'trial' ? 'warning' : 'success'}>
            {mod.status === 'trial' ? `Prueba · quedan ${diasPrueba} d` : 'Activo'}
          </Badge>
          {!mod.enabled && <Badge tone="neutral">Apagado</Badge>}
        </div>
      ) : !mod.isPublished ? (
        <Badge tone="neutral" dot={false}>
          En camino
        </Badge>
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
          {arrastrado ? 'Incluido por dependencia' : 'Agregar al calculo'}
        </label>
      )}
    </Card>
  )
}
