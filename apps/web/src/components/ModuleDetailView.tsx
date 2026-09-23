'use client'

import { useState, type ReactNode } from 'react'
import { Badge, Icon, cn } from '@regb/ui'
import { AREAS, CATEGORIES, areaDe, type ModuleDetail } from '@/lib/catalog'
import { solicitarActivacionForm, solicitarPruebaForm } from '@/app/marketplace/actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { TemaToggle } from '@/components/TemaToggle'
import { CapturaModulo } from '@/components/marketplace/CapturaModulo'
import { EstadoModulo } from '@/components/marketplace/EstadoModulo'
import { VisorCaptura } from '@/components/marketplace/VisorCaptura'
import {
  FOCO,
  PILL_CONTORNO,
  PILL_PRIMARIO,
  money,
  plural,
  tierLabel,
  usd,
} from '@/components/marketplace/formato'

/**
 * Ficha de un modulo.
 *
 * El orden es el de una conversacion de venta, no el de una tabla de la
 * base: primero que es y el dolor que quita, luego como se ve DE VERDAD
 * (la captura), luego que trae, y el precio siempre a la vista abajo.
 *
 * `'use client'` por el visor de la captura y las pestañas de los
 * esquemas; los botones de pedir son `<form action>` planos que funcionan
 * igual sin JavaScript.
 */

/** Lo que mandan los botones: lo ya pedido + este modulo + sus requisitos. */
export interface PedidoFicha {
  modulos: string[]
  /** Nota de la solicitud abierta, que se conserva al actualizarla. */
  nota: string | null
  /** Requisitos que entran solos, con nombre para decirlo. */
  requisitos: { id: string; name: string }[]
  /**
   * La factura con ESTE modulo y sus requisitos, segun `@regb/billing`:
   * la de hoy, la de despues, cuanto sube y cuanto cuesta instalar.
   */
  este: { hoy: number; con: number; aumento: number; instalacion: number }
  /** Modulos que ya estaban en la solicitud abierta. */
  previos: number
}

export interface Relacionado {
  id: string
  name: string
  icon: string
  tiene: boolean
  publicado: boolean
}

export function ModuleDetailView({
  mod,
  tier,
  backHref,
  demoQuery,
  hiddenFields,
  pedido,
  yaPedido,
  necesita,
  combina,
}: {
  mod: ModuleDetail
  tier: string
  backHref: string
  demoQuery: string
  hiddenFields: Record<string, string>
  /** `null` si no se puede pedir (ya lo tiene, es del plan o no ha salido). */
  pedido: PedidoFicha | null
  yaPedido: boolean
  necesita: Relacionado[]
  combina: Relacionado[]
}) {
  const [pantalla, setPantalla] = useState(0)
  const [visor, setVisor] = useState(false)

  const area = AREAS.find((a) => a.id === areaDe(mod))
  const categoria = CATEGORIES.find((c) => c.id === mod.category)?.label ?? mod.category
  const esquema = mod.screens[pantalla]

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--color-surface-base)]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 md:gap-3 md:px-6">
        <a
          href={backHref}
          className={cn(
            'inline-flex h-11 shrink-0 items-center gap-0.5 rounded-full pl-1.5 pr-3 text-sm font-semibold text-[var(--color-text-link)] hover:bg-[var(--color-surface-raised)] md:h-9',
            FOCO,
          )}
        >
          <Icon name="chevron_left" size={22} />
          Marketplace
        </a>
        <span className="hidden truncate text-sm font-semibold text-[var(--color-text-primary)] sm:inline">
          {mod.name}
        </span>
        <div className="flex-1" />
        <Badge tone="brand" dot={false}>
          Plan {tierLabel(tier)}
        </Badge>
        <TemaToggle />
      </header>

      <main className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 pb-12 pt-6 md:px-6 md:pt-10">
          {/* ── Que es ────────────────────────────────────────────── */}
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            <Icon name={mod.icon} size={16} />
            {area?.label ?? 'Módulo'} · {categoria}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--color-text-primary)] md:text-5xl">
            {mod.name}
          </h1>
          <p className="mt-3 max-w-3xl text-lg text-[var(--color-text-secondary)] md:text-xl">
            {mod.tagline || mod.description}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <EstadoModulo mod={mod} largo />
            {pedido && !yaPedido && (
              <Badge tone="brand" dot={false}>
                <Icon name="bolt" size={14} />
                Disponible para tu plan
              </Badge>
            )}
            {yaPedido && (
              <Badge tone="info" dot={false}>
                <Icon name="mark_email_read" size={14} />
                Ya está en tu solicitud
              </Badge>
            )}
            {mod.setupMinutes !== null && (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <Icon name="timer" size={14} />
                Se configura en unos {mod.setupMinutes} minutos
              </span>
            )}
          </div>

          {pedido && !yaPedido && (
            <NotaPedido
              pedido={pedido}
              className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] px-3 py-2 sm:hidden"
            />
          )}

          {/* ── Como se ve: la captura real ───────────────────────── */}
          <figure className="mt-8">
            {mod.hasScreenshot ? (
              <button
                type="button"
                onClick={() => setVisor(true)}
                aria-haspopup="dialog"
                className={cn(
                  'group relative block w-full overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] text-left',
                  FOCO,
                )}
              >
                <CapturaModulo mod={mod} grande className="aspect-[16/10] w-full" />
                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-base)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
                  <Icon name="zoom_in" size={16} />
                  Ver en grande
                  <span className="sr-only">: pantalla de {mod.name}</span>
                </span>
              </button>
            ) : (
              <CapturaModulo
                mod={mod}
                grande
                className="aspect-[16/10] w-full rounded-[var(--radius-xl)] border border-[var(--color-border)]"
              />
            )}
            <figcaption className="mt-2 text-xs text-[var(--color-text-muted)]">
              {mod.hasScreenshot
                ? 'La pantalla principal tal como la vas a usar, con datos de demostración.'
                : mod.isPublished
                  ? `Todavía no tenemos la captura de esta pantalla${mod.screens.length > 0 ? '; abajo tienes su esquema' : ''}.`
                  : 'Este módulo todavía no está disponible, así que no hay pantalla que enseñar.'}
            </figcaption>
          </figure>

          {mod.problem && (
            <section className="mt-10 rounded-[var(--radius-xl)] bg-[var(--color-surface-raised)] p-5 md:p-6">
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                El problema que te quita
              </h2>
              <p className="mt-2 text-base leading-relaxed text-[var(--color-text-primary)]">
                {mod.problem}
              </p>
            </section>
          )}

          {/* ── Que trae ──────────────────────────────────────────── */}
          {mod.features.length > 0 && (
            <Seccion titulo="Qué incluye">
              <ul className="grid gap-3 sm:grid-cols-2">
                {mod.features.map((f) => (
                  <li
                    key={f.titulo}
                    className="flex gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4"
                  >
                    <Icon
                      name="check_circle"
                      size={20}
                      className="mt-px shrink-0 text-[var(--color-text-link)]"
                    />
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {f.titulo}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                        {f.detalle}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}

          {/* ── Las otras pantallas, en esquema ───────────────────── */}
          {mod.screens.length > 0 && (
            <Seccion
              titulo="Sus pantallas, en esquema"
              nota={
                <>
                  Arriba tienes la captura real de la pantalla principal: se vuelve a tomar de la
                  app en cada versión con{' '}
                  <code className="rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-1 font-[family-name:var(--font-mono)]">
                    pnpm capturas:marketplace
                  </code>
                  , así que no envejece. Estos esquemas enseñan el resto de lo que trae.
                </>
              }
            >
              {mod.screens.length > 1 && (
                <div
                  role="group"
                  aria-label="Elegir pantalla"
                  className="mb-3 flex flex-wrap gap-1.5"
                >
                  {mod.screens.map((s, i) => (
                    <button
                      key={s.titulo}
                      type="button"
                      onClick={() => setPantalla(i)}
                      aria-pressed={i === pantalla}
                      className={cn(
                        'inline-flex h-11 items-center rounded-full px-3.5 text-[13px] transition-colors duration-100 md:h-8',
                        FOCO,
                        i === pantalla
                          ? 'bg-[var(--color-brand)] font-semibold text-[var(--color-text-on-brand)]'
                          : 'border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
                      )}
                    >
                      {s.titulo}
                    </button>
                  ))}
                </div>
              )}
              {esquema && (
                <div>
                  <p className="mb-2 text-sm text-[var(--color-text-secondary)]">
                    {esquema.descripcion}
                  </p>
                  <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-deepest)] p-4">
                    <pre
                      aria-label={`Esquema de ${esquema.titulo}`}
                      className="font-[family-name:var(--font-mono)] text-[11px] leading-[1.5] text-[var(--color-text-secondary)] md:text-xs"
                    >
                      {esquema.mockup}
                    </pre>
                  </div>
                </div>
              )}
            </Seccion>
          )}

          {/* ── A quien le sirve ──────────────────────────────────── */}
          {mod.audience.length > 0 && (
            <Seccion titulo="A quién le sirve">
              <ul className="grid gap-2 sm:grid-cols-2">
                {mod.audience.map((a) => (
                  <li key={a} className="flex gap-2 text-sm text-[var(--color-text-secondary)]">
                    <Icon
                      name="check"
                      size={18}
                      className="shrink-0 text-[var(--color-semantic-text-success)]"
                    />
                    {a}
                  </li>
                ))}
              </ul>
            </Seccion>
          )}

          {/* ── Con que va ────────────────────────────────────────── */}
          {(necesita.length > 0 || combina.length > 0) && (
            <Seccion titulo="Con qué funciona">
              <div className="space-y-4">
                {necesita.length > 0 && (
                  <ListaRelacionados
                    titulo="Necesita"
                    explicacion="Sin estos no funciona. Si te falta alguno, entra solo en tu pedido."
                    items={necesita}
                    demoQuery={demoQuery}
                  />
                )}
                {combina.length > 0 && (
                  <ListaRelacionados
                    titulo="Combina bien con"
                    explicacion="Opcionales: el módulo funciona sin ellos, solo que con menos."
                    items={combina}
                    demoQuery={demoQuery}
                  />
                )}
              </div>
            </Seccion>
          )}

          {/* ── Donde corre ───────────────────────────────────────── */}
          <Seccion titulo="Dónde corre">
            <ul className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ['web', 'language', 'Navegador', 'Desde cualquier computadora'],
                  [
                    'desktop',
                    'desktop_windows',
                    'Escritorio',
                    'App instalada, funciona sin internet',
                  ],
                  ['mobile', 'smartphone', 'Celular', 'Android y iPhone'],
                ] as const
              ).map(([k, icono, titulo, detalle]) => {
                const soportado = mod.platforms[k]
                return (
                  <li
                    key={k}
                    className={cn(
                      'flex items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3',
                      soportado
                        ? 'border-[var(--color-border)] bg-[var(--color-surface-raised)]'
                        : 'border-dashed border-[var(--color-border)]',
                    )}
                  >
                    <Icon
                      name={soportado ? icono : 'block'}
                      size={20}
                      className={cn(
                        'mt-px shrink-0',
                        soportado
                          ? 'text-[var(--color-text-link)]'
                          : 'text-[var(--color-text-muted)]',
                      )}
                    />
                    <div>
                      <p
                        className={cn(
                          'text-sm font-semibold',
                          soportado
                            ? 'text-[var(--color-text-primary)]'
                            : 'text-[var(--color-text-muted)]',
                        )}
                      >
                        {titulo}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                        {soportado ? detalle : 'Todavía no está en esta plataforma'}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Seccion>

          {/* ── Preguntas ─────────────────────────────────────────── */}
          {mod.faq.length > 0 && (
            <Seccion titulo="Preguntas frecuentes">
              <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)]">
                {mod.faq.map((f) => (
                  <details key={f.p} className="group">
                    <summary
                      className={cn(
                        'flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] marker:content-[""] [&::-webkit-details-marker]:hidden',
                        FOCO,
                        'focus-visible:-outline-offset-2',
                      )}
                    >
                      <Icon
                        name="chevron_right"
                        size={18}
                        className="shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 group-open:rotate-90"
                      />
                      {f.p}
                    </summary>
                    <p className="px-4 pb-4 pl-10 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                      {f.r}
                    </p>
                  </details>
                ))}
              </div>
            </Seccion>
          )}
        </div>
      </main>

      {/* ── Precio y accion, pegados abajo ───────────────────────── */}
      <section
        aria-label="Precio y solicitud"
        className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-deep)]"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 md:px-6">
          <Precio mod={mod} tier={tier} />

          <div className="flex min-w-0 flex-1 basis-64 flex-col items-stretch gap-2 sm:items-end">
            <Accion
              mod={mod}
              pedido={pedido}
              yaPedido={yaPedido}
              hiddenFields={hiddenFields}
              backHref={backHref}
            />
          </div>
        </div>
      </section>

      {mod.hasScreenshot && (
        <VisorCaptura mod={mod} abierto={visor} onCerrar={() => setVisor(false)} />
      )}
    </div>
  )
}

function Seccion({
  titulo,
  nota,
  children,
}: {
  titulo: string
  nota?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)] md:text-2xl">
        {titulo}
      </h2>
      {nota && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{nota}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function ListaRelacionados({
  titulo,
  explicacion,
  items,
  demoQuery,
}: {
  titulo: string
  explicacion: string
  items: Relacionado[]
  demoQuery: string
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{titulo}</h3>
      <p className="text-xs text-[var(--color-text-muted)]">{explicacion}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((r) => (
          <li key={r.id}>
            <a
              href={`/marketplace/${r.id}${demoQuery}`}
              className={cn(
                'inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 text-[13px] text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] md:h-8',
                FOCO,
              )}
            >
              <Icon name={r.icon} size={16} className="text-[var(--color-text-muted)]" />
              {r.name}
              {r.tiene ? (
                <span className="inline-flex items-center gap-0.5 text-xs text-[var(--color-semantic-text-success)]">
                  <Icon name="check" size={14} />
                  lo tienes
                </span>
              ) : !r.publicado ? (
                <span className="text-xs text-[var(--color-text-muted)]">· próximamente</span>
              ) : (
                <span className="text-xs text-[var(--color-text-muted)]">· te falta</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Precio({ mod, tier }: { mod: ModuleDetail; tier: string }) {
  if (mod.category === 'core') {
    return (
      <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
        <Icon name="verified" size={18} className="text-[var(--color-text-link)]" />
        Incluido en tu plan {tierLabel(tier)}: no cuesta aparte.
      </p>
    )
  }
  // Compacto a proposito: en un telefono la barra no puede comerse media
  // pantalla. Mensualidad grande (lo que se compara), el resto en una linea.
  return (
    <div>
      <p className="tabular flex items-baseline gap-0.5">
        <span className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
          US$ {money(mod.monthlyPrice)}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">/mes</span>
      </p>
      <p className="tabular text-xs text-[var(--color-text-muted)]">
        + US$ {money(mod.installPrice)} de instalación, una vez · precio de lista del plan{' '}
        {tierLabel(tier)}, antes de ITBIS
        {mod.status === 'trial' ? ' · gratis mientras dure la prueba' : ''}
      </p>
      {mod.metered && (
        <p className="tabular text-xs text-[var(--color-text-muted)]">
          Por uso: {mod.metered.included} {mod.metered.key}s incluidos, luego US${' '}
          {mod.metered.price} c/u
        </p>
      )}
    </div>
  )
}

/** Lo que el cliente tiene que saber antes de pulsar: requisitos, suma y que nada se enciende solo. */
function NotaPedido({ pedido, className }: { pedido: PedidoFicha; className?: string }) {
  const { hoy, con, aumento, instalacion } = pedido.este
  return (
    <p className={cn('text-xs text-[var(--color-text-muted)]', className)}>
      {pedido.requisitos.length > 0 &&
        `Incluye ${pedido.requisitos.map((r) => r.name).join(', ')}, porque sin ${pedido.requisitos.length === 1 ? 'eso' : 'esos'} no funciona. `}
      Tu factura pasaría de {usd(hoy)} a{' '}
      <strong className="font-semibold text-[var(--color-text-primary)]">{usd(con)}</strong> al mes
      {aumento > 0 ? ` (+${usd(aumento)})` : ' (sin aumento: entra en lo que regala tu plan)'}
      {instalacion > 0 ? `, más ${usd(instalacion)} de instalación una vez` : ''}. Calculado con el
      mismo motor que emite tu factura, ITBIS incluido.{' '}
      {pedido.previos > 0 &&
        `Se suma a tu solicitud abierta (${plural(pedido.previos, 'módulo', 'módulos')}). `}
      Nada se enciende solo: te llamamos. La prueba no se cobra.
    </p>
  )
}

/**
 * Los botones de abajo. Ninguno es un boton muerto:
 *
 *  - "Solicitar activacion" usa `solicitarActivacionForm`, la misma accion
 *    del simulador, con el pedido completo que armo el servidor.
 *  - "Probar 14 dias" usa `solicitarPruebaForm`: la misma solicitud,
 *    marcada como prueba. No hay encendido de prueba en autoservicio; lo
 *    enciende el proveedor desde /control, y alli ENTRA como prueba de 14
 *    dias. El texto de abajo lo dice tal cual.
 *
 * El aviso de "recibimos tu pedido" lo pinta `marketplace/layout.tsx`.
 */
function Accion({
  mod,
  pedido,
  yaPedido,
  hiddenFields,
  backHref,
}: {
  mod: ModuleDetail
  pedido: PedidoFicha | null
  yaPedido: boolean
  hiddenFields: Record<string, string>
  backHref: string
}) {
  if (mod.status === 'active' || mod.status === 'trial') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
        <Icon
          name="check_circle"
          size={18}
          filled
          className="text-[var(--color-semantic-text-success)]"
        />
        {mod.status === 'trial'
          ? 'Lo estás probando. Al terminar deja de verse, pero tus datos se quedan.'
          : 'Ya lo tienes en tu cuenta.'}
      </p>
    )
  }
  if (!mod.isPublished) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
        <Icon name="construction" size={18} className="text-[var(--color-text-muted)]" />
        Todavía no está disponible. Aquí verás la fecha cuando la tengamos.
      </p>
    )
  }
  if (mod.category === 'core' || !pedido) return null

  if (yaPedido) {
    return (
      <p className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm text-[var(--color-text-secondary)]">
        <Icon name="mark_email_read" size={18} className="text-[var(--color-text-link)]" />
        Ya lo pediste: te llamamos para dejarlo funcionando.
        <a
          href={backHref}
          className={cn(
            'rounded-[var(--radius-sm)] font-semibold text-[var(--color-text-link)] hover:underline',
            FOCO,
          )}
        >
          Ver tu solicitud
        </a>
      </p>
    )
  }

  const campos = (
    <>
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="modulos" value={JSON.stringify(pedido.modulos)} />
      {pedido.nota && <input type="hidden" name="nota" value={pedido.nota} />}
    </>
  )

  return (
    <>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {/* Ya la probo y vencio: se le ofrece activarlo, no otra prueba gratis. */}
        {mod.status !== 'trial_expired' && (
          <form action={solicitarPruebaForm} className="flex-1 sm:flex-none">
            {campos}
            <BotonEnvio className={cn(PILL_CONTORNO, 'w-full')}>
              <Icon name="hourglass_top" size={16} />
              Probar 14 días
            </BotonEnvio>
          </form>
        )}
        <form action={solicitarActivacionForm} className="flex-1 sm:flex-none">
          {campos}
          <BotonEnvio className={cn(PILL_PRIMARIO, 'w-full')}>Solicitar activación</BotonEnvio>
        </form>
      </div>
      {/* En movil esta nota vive arriba, junto al estado (ver la ficha). */}
      <NotaPedido pedido={pedido} className="hidden sm:block sm:text-right" />
    </>
  )
}
