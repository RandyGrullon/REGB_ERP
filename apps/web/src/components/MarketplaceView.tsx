'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, EmptyState, Icon, cn } from '@regb/ui'
import {
  AREAS,
  areaDe,
  cerrarDependencias,
  estaActivo,
  seleccionDesdeSolicitud,
  sePuedePedir,
  type AreaId,
  type CatalogEntry,
  type CotizacionMotor,
  type SolicitudPendiente,
} from '@/lib/catalog'
import { TemaToggle } from '@/components/TemaToggle'
import { PaquetesNegocio } from '@/components/marketplace/PaquetesNegocio'
import { Simulador } from '@/components/marketplace/Simulador'
import { TarjetaModulo } from '@/components/marketplace/TarjetaModulo'
import {
  FOCO,
  diasRestantes,
  fechaCorta,
  plural,
  tierLabel,
  usd,
} from '@/components/marketplace/formato'

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
 *  3. **El precio que se enseña es el del tier del cliente que mira.**
 *
 * `'use client'` porque filtro, busqueda, orden y simulador son estado
 * del navegador; los datos llegan ya resueltos del servidor (catalogo,
 * precios del tier, capturas que existen y la solicitud abierta).
 *
 * Orden de la pagina, que es el de una conversacion de venta: que es esto
 * y cuanto pagas hoy → "¿que tipo de negocio eres?" → el catalogo por area
 * de negocio → el simulador, siempre a mano abajo.
 */

type Orden = 'recomendado' | 'precio-asc' | 'precio-desc' | 'nombre'

/**
 * Recomendado: lo que se puede encender hoy primero, lo que necesita algo
 * antes despues, lo que ya tienes o viene en el plan luego, y lo que
 * todavia no existe al final.
 */
const peso = (m: CatalogEntry) =>
  !m.isPublished
    ? 4
    : estaActivo(m) || m.category === 'core'
      ? 3
      : m.missingRequires.length > 0
        ? 1
        : 0

export function MarketplaceView({
  catalog,
  tier,
  tenantName,
  roleName,
  backHref,
  demoQuery,
  hiddenFields,
  solicitudPendiente,
  cotizacionInicial,
  cotizacionesPaquetes,
  puedePedir = true,
}: {
  catalog: CatalogEntry[]
  tier: string
  tenantName: string
  roleName: string
  backHref: string
  /** `?tenant=…&rol=…` en modo demo, vacio con sesion real. */
  demoQuery: string
  hiddenFields: Record<string, string>
  /** Ya hay una peticion abierta: el cliente tiene que saberlo. */
  solicitudPendiente: SolicitudPendiente | null
  /**
   * La factura de hoy y la de lo que llega marcado (la solicitud abierta),
   * calculadas en el servidor con `@regb/billing`.
   */
  cotizacionInicial: CotizacionMotor | null
  /** Cuanto sube la factura con cada paquete, segun el mismo motor. */
  cotizacionesPaquetes: Record<string, { aumento: number; instalacion: number }>
  /** Solo quien paga pide (`subscription.manage`); el resto ve y simula. */
  puedePedir?: boolean
}) {
  const porId = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog])

  const [area, setArea] = useState<AreaId | 'todas'>('todas')
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<Orden>('recomendado')
  const [soloDisponibles, setSoloDisponibles] = useState(false)
  const [pedido, setPedido] = useState(false)

  /**
   * La solicitud abierta entra al simulador al llegar. Pedir de nuevo
   * REEMPLAZA esa solicitud (una pendiente por cliente, 0035): si el
   * simulador arrancara vacio, pedir un modulo mas borraria en silencio
   * todo lo pedido antes. Se cargan solo los que el cliente eligio; sus
   * requisitos los vuelve a calcular el cierre de dependencias.
   */
  const [marcados, setMarcados] = useState<Set<string>>(() =>
    // La misma funcion con la que el servidor cotizo de entrada: si no
    // coincidieran, el simulador arrancaria "calculando".
    seleccionDesdeSolicitud(solicitudPendiente, new Map(catalog.map((m) => [m.id, m]))),
  )

  const { total, anadidos } = useMemo(() => cerrarDependencias(marcados, porId), [marcados, porId])

  // Enterprise solo existe para el tier grande: a los demas ni se les ensena.
  const delTier = useMemo(
    () => catalog.filter((m) => m.category !== 'enterprise' || tier === 'grande'),
    [catalog, tier],
  )

  /** Busqueda + "solo lo que puedo encender hoy". El area se aplica despues. */
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return delTier.filter((m) => {
      if (soloDisponibles && !sePuedePedir(m)) return false
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.includes(q)
      )
    })
  }, [delTier, busqueda, soloDisponibles])

  const porArea = useMemo(() => {
    const cuenta = new Map<AreaId, number>()
    for (const m of filtrados) cuenta.set(areaDe(m), (cuenta.get(areaDe(m)) ?? 0) + 1)
    return cuenta
  }, [filtrados])

  const secciones = useMemo(() => {
    const ordenar = (a: CatalogEntry, b: CatalogEntry) => {
      if (orden === 'nombre') return a.name.localeCompare(b.name, 'es')
      if (orden === 'precio-asc') return a.monthlyPrice - b.monthlyPrice
      if (orden === 'precio-desc') return b.monthlyPrice - a.monthlyPrice
      return peso(a) - peso(b) || a.name.localeCompare(b.name, 'es')
    }
    return AREAS.filter((a) => area === 'todas' || a.id === area)
      .map((a) => ({
        area: a,
        mods: filtrados.filter((m) => areaDe(m) === a.id).sort(ordenar),
      }))
      .filter((s) => s.mods.length > 0)
  }, [filtrados, area, orden])

  const visibles = secciones.reduce((n, s) => n + s.mods.length, 0)

  // Cifras del encabezado.
  const activos = delTier.filter(estaActivo)
  const enPrueba = activos.filter((m) => m.status === 'trial')
  const pruebasVencidas = delTier.filter((m) => m.status === 'trial_expired')
  const paraHoy = delTier.filter(sePuedePedir).length
  const proximamente = delTier.filter((m) => !m.isPublished).length
  // Lo que se cobra hoy, segun el motor de facturacion (plan, modulos,
  // descuento e ITBIS; las pruebas no se cobran).
  const pagasHoy = cotizacionInicial?.hoy.total ?? null

  const toggle = (id: string) =>
    setMarcados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const limpiarFiltros = () => {
    setBusqueda('')
    setArea('todas')
    setSoloDisponibles(false)
  }

  const nombres = (ids: string[]) => ids.map((id) => porId.get(id)?.name ?? id)

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--color-surface-base)]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 md:gap-3 md:px-6">
        <a
          href={backHref}
          className={cn(
            'inline-flex h-11 items-center gap-0.5 rounded-full pl-1.5 pr-3 text-sm font-semibold text-[var(--color-text-link)] hover:bg-[var(--color-surface-raised)] md:h-9',
            FOCO,
          )}
        >
          <Icon name="chevron_left" size={22} />
          Volver
        </a>
        <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
          Marketplace
        </span>
        <div className="flex-1" />
        <span className="hidden truncate text-xs text-[var(--color-text-muted)] md:inline">
          {tenantName} · {roleName}
        </span>
        <Badge tone="brand" dot={false}>
          Plan {tierLabel(tier)}
        </Badge>
        <TemaToggle />
      </header>

      {/* `relative` en `main` y en cada fila que se desliza de lado: los
          textos `sr-only` son `absolute`, y sin un ancestro posicionado se
          escapaban del scroll horizontal y ensanchaban la pagina en movil. */}
      <main className="relative flex-1 overflow-y-auto" id="contenido">
        <div className="mx-auto max-w-7xl space-y-10 px-4 pb-12 pt-6 md:px-6 md:pt-10">
          {/* ── Propuesta de valor ────────────────────────────────── */}
          <section aria-labelledby="mk-titulo">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Marketplace de módulos · {tenantName}
            </p>
            <h1
              id="mk-titulo"
              className="mt-2 max-w-3xl text-3xl font-bold tracking-tight text-[var(--color-text-primary)] md:text-4xl"
            >
              Enciende solo lo que tu negocio usa.
            </h1>
            <p className="mt-3 max-w-2xl text-base text-[var(--color-text-secondary)]">
              Cada módulo se paga aparte, al precio de tu plan {tierLabel(tier)}. Mira la pantalla
              real antes de decidir, simula cuánto sumaría a tu factura —con el mismo cálculo que la
              emite— y pídelo: te llamamos, lo dejamos funcionando con tus datos y{' '}
              <strong className="font-semibold text-[var(--color-text-primary)]">
                nada se activa sin tu visto bueno
              </strong>
              .
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Dato
                icono="check_circle"
                etiqueta="Activos en tu cuenta"
                valor={String(activos.length)}
              />
              <Dato icono="bolt" etiqueta="Para encender hoy" valor={String(paraHoy)} />
              <Dato icono="construction" etiqueta="En camino" valor={String(proximamente)} />
              {puedePedir && (
                <Dato
                  icono="payments"
                  etiqueta="Tu mensualidad hoy"
                  valor={pagasHoy === null ? '—' : usd(pagasHoy)}
                  sufijo="/mes"
                />
              )}
            </dl>
          </section>

          {/* ── Avisos ────────────────────────────────────────────── */}
          {(solicitudPendiente || pedido || enPrueba.length > 0 || pruebasVencidas.length > 0) && (
            <div className="space-y-3">
              {(solicitudPendiente || pedido) && (
                <Aviso icono="mark_email_read" tono="success" rol="status">
                  <strong className="font-semibold text-[var(--color-text-primary)]">
                    Tu solicitud está en camino.
                  </strong>{' '}
                  {solicitudPendiente &&
                    `Pediste ${plural(solicitudPendiente.modules.length, 'módulo', 'módulos')} el ${fechaCorta(solicitudPendiente.createdAt)}; ya está cargada en el simulador. `}
                  Nadie activa nada por su cuenta: te llamamos para cotizar la instalación y ver si
                  hay datos que migrar. Si cambias algo y vuelves a pedir, actualizamos esa misma
                  solicitud.
                </Aviso>
              )}
              {enPrueba.length > 0 && (
                <Aviso icono="hourglass_top" tono="warning" rol="note">
                  Tienes {plural(enPrueba.length, 'módulo', 'módulos')} en prueba:{' '}
                  <strong className="font-semibold text-[var(--color-text-primary)]">
                    {enPrueba
                      .map((m) => {
                        const d = diasRestantes(m.trialEndsAt)
                        return d === null
                          ? m.name
                          : `${m.name} (quedan ${plural(d, 'día', 'días')})`
                      })
                      .join(', ')}
                  </strong>
                  . No se cobran mientras dure la prueba. Al terminar dejan de verse, pero{' '}
                  <strong className="font-semibold text-[var(--color-text-primary)]">
                    tus datos se quedan
                  </strong>{' '}
                  por si los reactivas.
                </Aviso>
              )}
              {pruebasVencidas.length > 0 && (
                <Aviso icono="event_busy" tono="warning" rol="note">
                  Terminó tu prueba de{' '}
                  <strong className="font-semibold text-[var(--color-text-primary)]">
                    {pruebasVencidas.map((m) => m.name).join(', ')}
                  </strong>
                  : ya no se ve ni se cobra, pero{' '}
                  <strong className="font-semibold text-[var(--color-text-primary)]">
                    tus datos se quedan
                  </strong>
                  . Si quieres seguir usándolo, márcalo y pide la activación.
                </Aviso>
              )}
            </div>
          )}

          {/* ── Por tipo de negocio ───────────────────────────────── */}
          <PaquetesNegocio
            porId={porId}
            cotizaciones={cotizacionesPaquetes}
            enSimulador={total}
            onCargar={(ids) => setMarcados((prev) => new Set([...prev, ...ids]))}
            onQuitar={(ids) =>
              setMarcados((prev) => {
                const next = new Set(prev)
                for (const id of ids) next.delete(id)
                return next
              })
            }
          />

          {/* ── Catalogo ──────────────────────────────────────────── */}
          <section aria-labelledby="catalogo-titulo">
            <div className="mb-4">
              <h2
                id="catalogo-titulo"
                className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]"
              >
                Todo el catálogo
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                Agrupado por área de tu negocio. Toca un módulo para ver su pantalla en grande, qué
                incluye y las preguntas de siempre.
              </p>
            </div>

            {/* Barra de filtros: pegada arriba en escritorio mientras se recorre el
                catalogo. En movil ocupa media pantalla, asi que ahi se va con el scroll. */}
            <div className="z-10 -mx-4 space-y-3 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface-base)_94%,transparent)] px-4 py-3 backdrop-blur md:-mx-6 md:px-6 md:sticky md:top-0">
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <label className="relative flex w-full items-center sm:w-72">
                  <span className="sr-only">Buscar módulo</span>
                  <Icon
                    name="search"
                    size={18}
                    className="pointer-events-none absolute left-3 text-[var(--color-text-muted)]"
                  />
                  <input
                    type="search"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar: nómina, cuadre, inventario…"
                    className={cn(
                      'h-11 w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface-input)] pl-9 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:border-[var(--color-brand-bright)] md:h-9',
                      FOCO,
                    )}
                  />
                </label>

                <div className="flex flex-1 flex-wrap items-center justify-between gap-2 sm:justify-end md:gap-3">
                  <Interruptor
                    activo={soloDisponibles}
                    onCambio={setSoloDisponibles}
                    etiqueta="Solo lo que puedo encender hoy"
                  />
                  <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    Ordenar
                    <select
                      value={orden}
                      onChange={(e) => setOrden(e.target.value as Orden)}
                      className={cn(
                        'h-11 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)] md:h-9',
                        FOCO,
                      )}
                    >
                      <option value="recomendado">Recomendado</option>
                      <option value="precio-asc">Más barato primero</option>
                      <option value="precio-desc">Más caro primero</option>
                      <option value="nombre">Por nombre</option>
                    </select>
                  </label>
                </div>
              </div>

              <div
                role="group"
                aria-label="Filtrar por área"
                className="relative -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
              >
                <Chip
                  activo={area === 'todas'}
                  onClick={() => setArea('todas')}
                  cuenta={filtrados.length}
                >
                  Todo
                </Chip>
                {AREAS.filter((a) => (porArea.get(a.id) ?? 0) > 0 || area === a.id).map((a) => (
                  <Chip
                    key={a.id}
                    activo={area === a.id}
                    onClick={() => setArea(a.id)}
                    cuenta={porArea.get(a.id) ?? 0}
                    icono={a.icon}
                  >
                    {a.label}
                  </Chip>
                ))}
              </div>
            </div>

            <p role="status" aria-live="polite" className="sr-only">
              {plural(visibles, 'módulo', 'módulos')} a la vista
            </p>

            {visibles === 0 ? (
              <EmptyState
                icon="search_off"
                title="Nada por aquí con esos filtros"
                description="Ni buscando con linterna. Prueba con otra palabra o quita un filtro; los módulos siguen ahí."
                action={
                  <Button size="sm" onClick={limpiarFiltros}>
                    Limpiar filtros
                  </Button>
                }
              />
            ) : (
              <div className="mt-6 space-y-12">
                {secciones.map(({ area: a, mods }) => {
                  const suyos = mods.filter(estaActivo).length
                  return (
                    <section key={a.id} aria-labelledby={`area-${a.id}`}>
                      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h3
                          id={`area-${a.id}`}
                          className="flex items-center gap-2 text-lg font-bold tracking-tight text-[var(--color-text-primary)]"
                        >
                          <Icon
                            name={a.icon}
                            size={22}
                            className="text-[var(--color-text-muted)]"
                          />
                          {a.label}
                        </h3>
                        <p className="tabular text-sm text-[var(--color-text-muted)]">
                          {plural(mods.length, 'módulo', 'módulos')}
                          {suyos > 0 && ` · ${plural(suyos, 'activo', 'activos')}`}
                        </p>
                        <p className="basis-full text-sm text-[var(--color-text-secondary)]">
                          {a.hint}
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {mods.map((m) => (
                          <TarjetaModulo
                            key={m.id}
                            mod={m}
                            marcado={marcados.has(m.id)}
                            arrastrado={total.has(m.id) && !marcados.has(m.id)}
                            onToggle={() => toggle(m.id)}
                            detailHref={`/marketplace/${m.id}${demoQuery}`}
                            necesita={nombres(m.missingRequires)}
                          />
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </main>

      <Simulador
        porId={porId}
        marcados={marcados}
        total={total}
        anadidos={anadidos}
        tier={tier}
        cotizacionInicial={cotizacionInicial}
        hiddenFields={hiddenFields}
        puedePedir={puedePedir}
        notaPendiente={solicitudPendiente?.nota ?? null}
        onQuitar={toggle}
        onLimpiar={() => setMarcados(new Set())}
        onPedido={() => setPedido(true)}
      />
    </div>
  )
}

/** Cifra del encabezado: superficie distinta, sin sombra ni borde grueso. */
function Dato({
  icono,
  etiqueta,
  valor,
  sufijo,
}: {
  icono: string
  etiqueta: string
  valor: string
  sufijo?: string
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        <Icon name={icono} size={16} />
        {etiqueta}
      </dt>
      <dd className="tabular mt-1 flex items-baseline gap-0.5">
        <span className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
          {valor}
        </span>
        {sufijo && <span className="text-xs text-[var(--color-text-muted)]">{sufijo}</span>}
      </dd>
    </div>
  )
}

/** Aviso en linea: superficie + icono de estado + texto. El color solo en el icono. */
function Aviso({
  icono,
  tono,
  rol,
  children,
}: {
  icono: string
  tono: 'success' | 'warning'
  rol: 'status' | 'note'
  children: ReactNode
}) {
  return (
    <div
      role={rol}
      className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-sm leading-relaxed text-[var(--color-text-secondary)]"
    >
      <Icon
        name={icono}
        size={22}
        filled
        className={cn(
          'shrink-0',
          tono === 'success'
            ? 'text-[var(--color-semantic-text-success)]'
            : 'text-[var(--color-semantic-text-warning)]',
        )}
      />
      <p>{children}</p>
    </div>
  )
}

/** Interruptor de Apple: `role="switch"` con su estado, 44px de alto en movil. */
function Interruptor({
  activo,
  onCambio,
  etiqueta,
}: {
  activo: boolean
  onCambio: (v: boolean) => void
  etiqueta: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      onClick={() => onCambio(!activo)}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-full pr-2 text-xs text-[var(--color-text-secondary)] md:h-9',
        FOCO,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ease-out',
          activo ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-border-strong)]',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-[var(--color-text-on-brand)] transition-transform duration-150 ease-out',
            activo ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </span>
      {etiqueta}
    </button>
  )
}

/** Filtro en pildora con su conteo. `aria-pressed` dice cual esta puesto. */
function Chip({
  activo,
  onClick,
  cuenta,
  icono,
  children,
}: {
  activo: boolean
  onClick: () => void
  cuenta: number
  icono?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors duration-100 ease-out md:h-9',
        FOCO,
        activo
          ? 'bg-[var(--color-brand)] font-semibold text-[var(--color-text-on-brand)]'
          : 'border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
      )}
    >
      {icono && <Icon name={icono} size={16} />}
      {children}
      <span
        className={cn(
          'tabular text-xs',
          activo ? 'text-[var(--color-text-on-brand)]' : 'text-[var(--color-text-muted)]',
        )}
      >
        {cuenta}
        <span className="sr-only"> módulos</span>
      </span>
    </button>
  )
}
