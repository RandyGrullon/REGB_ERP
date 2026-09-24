import Link from 'next/link'
import {
  Badge,
  EmptyState,
  FilterSelect,
  Icon,
  Mono,
  SearchField,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Toolbar,
  ToolbarActions,
} from '@regb/ui'
import { loadControlOverview, type ControlClient } from '@/lib/control'
import { cargarExtrasPorTenant, cargarSolicitudes, type ExtrasCliente } from '@/lib/control-datos'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'
import { cycleLabel, StatusBadge, TierBadge, usd } from '@/components/ControlBits'
import { activarSolicitud, descartarSolicitud, marcarContactada } from './solicitudes-actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Clientes · REGB Control' }

/**
 * Cartera de clientes de REGB (§12.4).
 *
 * Es la pantalla donde el dueno decide a quien llamar hoy, asi que ensena
 * lo que provoca una llamada —silencio, mora, prueba por vencer, salud
 * baja— y no solo lo que se cobra. Los filtros viajan por GET para que un
 * recorte util se pueda guardar como enlace.
 *
 * Todo sale de datos reales. Lo que todavia no se mide (transacciones,
 * consumos por uso) se dice que no se mide, en vez de ensenar un cero que
 * parece un dato. Usuarios, sucursales, empresas y storage si se cuentan
 * desde 0128.
 */

const TIER_LABEL = { pyme: 'PYME', mediano: 'Mediano', grande: 'Grande' } as const
// Los mismos nombres que el tablero de onboarding: si aqui dice "En
// produccion" y alli "En vivo", parecen dos etapas distintas.
const ETAPA_LABEL: Record<string, string> = {
  sold: 'Vendido',
  migration: 'Migración',
  config: 'Configuración',
  training: 'Capacitación',
  live: 'En vivo',
}

/** El filtro de estado ensenaba los valores del enum: `past_due`, `readonly`... */
const ESTADO_LABEL: Record<string, string> = {
  trial: 'En prueba',
  active: 'Activo',
  past_due: 'En mora',
  readonly: 'Solo lectura',
  suspended: 'Suspendido',
}

interface Params {
  q?: string
  tier?: string
  estado?: string
  ciclo?: string
  etapa?: string
  riesgo?: string
  orden?: string
}

const dias = (iso: string | null): number | null =>
  iso === null ? null : Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

function Silencio({ d }: { d: number | null }) {
  if (d === null) {
    return (
      <span
        title="Nunca ha registrado un movimiento"
        className="text-[var(--color-semantic-text-danger)]"
      >
        sin actividad
      </span>
    )
  }
  const tono =
    d >= 14
      ? 'text-[var(--color-semantic-text-danger)]'
      : d >= 7
        ? 'text-[var(--color-semantic-text-warning)]'
        : 'text-[var(--color-text-secondary)]'
  return (
    <span className={tono} title={`Último movimiento hace ${d} días`}>
      {d === 0 ? 'hoy' : `hace ${d} d`}
    </span>
  )
}

/** Barra de proporcion. Un numero grande al lado de otro no se compara solo. */
function Barra({ parte, total, color }: { parte: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((parte / total) * 100) : 0
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--color-surface-overlay)]"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      <span className="tabular text-xs text-[var(--color-text-muted)]">{pct}%</span>
    </span>
  )
}

export default async function ControlOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  await requireProvider()
  const p = await searchParams
  const { mrr, clients, byTier } = await loadControlOverview()
  const extras = await cargarExtrasPorTenant()
  const solicitudes = await cargarSolicitudes()

  // El id del tenant no viaja en ControlClient; se cruza por slug.
  const idPorSlug = new Map(
    (await db()<{ id: string; slug: string }[]>`select id::text, slug from regb.tenants`).map(
      (r) => [r.slug, r.id],
    ),
  )
  const extraDe = (c: ControlClient): ExtrasCliente =>
    extras.get(idPorSlug.get(c.slug) ?? '') ?? {
      ultimaActividad: null,
      movimientosMes: 0,
      usuarios: 0,
      sucursales: 0,
      etapaOnboarding: null,
      bloqueos: null,
    }

  const q = (p.q ?? '').trim().toLowerCase()
  const enRiesgo = (c: ControlClient) => {
    const e = extraDe(c)
    const d = dias(e.ultimaActividad)
    return (
      c.status === 'past_due' ||
      c.status === 'suspended' ||
      c.status === 'readonly' ||
      (c.healthScore !== null && c.healthScore < 70) ||
      d === null ||
      d >= 14 ||
      e.bloqueos !== null
    )
  }

  let filtrados = clients.filter((c) => {
    if (q !== '' && !`${c.legalName} ${c.tradeName} ${c.slug}`.toLowerCase().includes(q))
      return false
    if (p.tier && c.tier !== p.tier) return false
    if (p.estado && c.status !== p.estado) return false
    if (p.ciclo && c.billingCycle !== p.ciclo) return false
    if (p.etapa && extraDe(c).etapaOnboarding !== p.etapa) return false
    if (p.riesgo === '1' && !enRiesgo(c)) return false
    return true
  })

  const orden = p.orden ?? 'mrr'
  filtrados = [...filtrados].sort((a, b) => {
    if (orden === 'nombre') return a.legalName.localeCompare(b.legalName)
    if (orden === 'salud') return (a.healthScore ?? 999) - (b.healthScore ?? 999)
    if (orden === 'silencio') {
      const da = dias(extraDe(a).ultimaActividad) ?? 9999
      const dbb = dias(extraDe(b).ultimaActividad) ?? 9999
      return dbb - da
    }
    return b.monthlyNet - a.monthlyNet
  })

  const mrrFiltrado = filtrados.reduce((a, c) => a + c.monthlyNet, 0)
  const hayFiltro = Boolean(p.q || p.tier || p.estado || p.ciclo || p.etapa || p.riesgo)
  const riesgosos = clients.filter(enRiesgo)
  const enPrueba = clients.reduce((a, c) => a + c.trialModules, 0)
  const modulosDePago = clients.reduce((a, c) => a + c.paidModules, 0)

  return (
    <div className="space-y-5">
      {/* Alta de un cliente real (0133): antes era un insert a mano. */}
      <div className="flex justify-end">
        <Link
          href="/control/onboarding/nuevo"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          <Icon name="person_add" size={18} />
          Dar de alta un cliente
        </Link>
      </div>
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="MRR" value={usd(mrr)} hint="mensualidad de todos, sin ITBIS" />
        <StatCard label="ARR" value={usd(mrr * 12)} hint="anualizado" />
        <StatCard label="Clientes" value={String(clients.length)} hint="sin archivar" />
        <StatCard
          label="Módulos de pago"
          value={String(modulosDePago)}
          hint={enPrueba > 0 ? `+ ${enPrueba} en prueba` : 'ninguno en prueba'}
        />
        <StatCard
          label="Requieren atención"
          value={String(riesgosos.length)}
          hint="mora, silencio o salud baja"
        />
      </section>

      {solicitudes.length > 0 && (
        <section
          aria-label="Solicitudes de activación"
          className="rounded-[var(--radius-lg)] border border-[var(--color-semantic-success)] bg-[color-mix(in_srgb,var(--color-semantic-success)_8%,transparent)] p-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
            <Icon
              name="shopping_cart_checkout"
              size={20}
              filled
              className="text-[var(--color-semantic-text-success)]"
            />
            {solicitudes.length} cliente{solicitudes.length === 1 ? '' : 's'} quiere
            {solicitudes.length === 1 ? '' : 'n'} activar módulos
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Es lo único de este panel donde alguien está diciendo que quiere pagarte más. Llámalo
            hoy: la cotización que vio está guardada, así que la conversación arranca del mismo
            número. Después de la llamada, actívalo en prueba o, si ya dijo que sí, de pago.
          </p>
          <ul className="mt-3 space-y-3">
            {solicitudes.map((s) => {
              const hace = Math.max(0, dias(s.desde) ?? 0)
              const conItbis = s.impuesto > 0
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-3 text-sm first:border-0 first:pt-0"
                >
                  <Link
                    href={`/control/${s.slug}`}
                    className="font-semibold text-[var(--color-text-link)] hover:underline"
                  >
                    {s.tenant}
                  </Link>
                  <span className="text-sm text-[var(--color-text-primary)]">
                    {s.nombres.join(', ')}
                  </span>
                  {s.pidePrueba && <Badge tone="info">quiere probar primero</Badge>}
                  <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                    {hace === 0 ? 'hoy' : `hace ${hace} d`}
                  </span>
                  <span className="tabular w-full text-xs text-[var(--color-text-secondary)]">
                    Le subiría la factura {usd(s.mensual)} al mes
                    {conItbis ? ' con ITBIS' : ''} · instalación {usd(s.instalacion)}
                    {conItbis ? ' más ITBIS' : ''}, una sola vez
                  </span>
                  {s.nota && (
                    <span className="w-full text-xs italic text-[var(--color-text-secondary)]">
                      &ldquo;{s.nota}&rdquo;
                    </span>
                  )}
                  <span className="flex w-full flex-wrap items-start gap-2 pt-1">
                    <form action={activarSolicitud}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="modo" value="prueba" />
                      <BotonEnvio
                        title="Enciende los módulos en prueba de 14 días, sin cobrar, y avisa al cliente"
                        className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Icon name="rocket_launch" size={14} />
                        Activar en prueba 14 días
                      </BotonEnvio>
                    </form>
                    {/* De pago cobra: se confirma con lo que implica delante. */}
                    <details>
                      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] [&::-webkit-details-marker]:hidden">
                        <Icon name="payments" size={14} />
                        Activar de pago…
                      </summary>
                      <form
                        action={activarSolicitud}
                        className="mt-2 flex max-w-md flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 text-xs text-[var(--color-text-secondary)]"
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="modo" value="pago" />
                        <p>
                          Quedan activos desde ya y la próxima factura le cobra la instalación y la
                          mensualidad nueva. Hazlo solo si el cliente ya aceptó el precio.
                        </p>
                        <BotonEnvio className="flex h-9 items-center justify-center gap-1.5 self-start rounded-full bg-[var(--color-brand)] px-4 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                          Sí, activar de pago
                        </BotonEnvio>
                      </form>
                    </details>
                    <form action={marcarContactada}>
                      <input type="hidden" name="id" value={s.id} />
                      <BotonEnvio
                        title="Ya lo llamaste; sale de la lista sin activar nada"
                        className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Icon name="call" size={14} />
                        Ya lo llamé
                      </BotonEnvio>
                    </form>
                    {/* Descartar se lleva la venta: dos pasos y con motivo. */}
                    <details>
                      <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-full px-3 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-semantic-text-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] [&::-webkit-details-marker]:hidden">
                        Descartar…
                      </summary>
                      <form
                        action={descartarSolicitud}
                        className="mt-2 flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <input
                          name="motivo"
                          placeholder="Motivo (queda en el historial)"
                          aria-label="Motivo para descartar la solicitud"
                          className="h-9 w-56 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-xs text-[var(--color-text-primary)]"
                        />
                        <BotonEnvio className="flex h-9 items-center rounded-full border border-[var(--color-semantic-danger)] px-3 text-xs font-semibold text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                          Descartar solicitud
                        </BotonEnvio>
                      </form>
                    </details>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {riesgosos.length > 0 && !p.riesgo && (
        <div
          role="note"
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-semantic-warning)] bg-[color-mix(in_srgb,var(--color-semantic-warning)_10%,transparent)] p-3 text-sm"
        >
          <Icon
            name="notifications_active"
            size={20}
            filled
            className="shrink-0 text-[var(--color-semantic-text-warning)]"
          />
          <p className="text-[var(--color-text-secondary)]">
            Hay <strong className="text-[var(--color-text-primary)]">{riesgosos.length}</strong>{' '}
            cliente{riesgosos.length === 1 ? '' : 's'} en mora, en silencio hace más de 14 días, con
            salud bajo 70 o con un bloqueo de onboarding.{' '}
            <Link
              href="/control?riesgo=1&orden=silencio"
              className="text-[var(--color-text-link)] underline hover:no-underline"
            >
              Ver solo esos
            </Link>
            .
          </p>
        </div>
      )}

      {byTier.length > 0 && (
        <section
          aria-label="Reparto del MRR por tier"
          className="grid gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-3 sm:grid-cols-3"
        >
          {byTier.map((g) => (
            <div key={g.tier} className="flex items-center gap-3">
              <TierBadge tier={g.tier} />
              <span className="tabular text-sm font-semibold text-[var(--color-text-primary)]">
                {usd(g.mrr)}
              </span>
              <Barra parte={g.mrr} total={mrr} color="var(--color-brand)" />
              <span className="text-xs text-[var(--color-text-muted)]">
                {g.count} {g.count === 1 ? 'cliente' : 'clientes'}
              </span>
            </div>
          ))}
        </section>
      )}

      <Toolbar>
        <SearchField
          name="q"
          defaultValue={p.q ?? ''}
          placeholder="Nombre, marca o identificador…"
        />
        <FilterSelect label="Tier" name="tier" defaultValue={p.tier ?? ''} className="w-32">
          <option value="">Todos</option>
          {(['pyme', 'mediano', 'grande'] as const).map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Estado" name="estado" defaultValue={p.estado ?? ''} className="w-36">
          <option value="">Todos</option>
          {Object.entries(ESTADO_LABEL).map(([s, label]) => (
            <option key={s} value={s}>
              {label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Ciclo" name="ciclo" defaultValue={p.ciclo ?? ''} className="w-36">
          <option value="">Todos</option>
          {['monthly', 'annual', 'biennial', 'triennial'].map((c) => (
            <option key={c} value={c}>
              {cycleLabel(c)}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Onboarding" name="etapa" defaultValue={p.etapa ?? ''} className="w-40">
          <option value="">Todas</option>
          {Object.entries(ETAPA_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Ordenar por" name="orden" defaultValue={orden} className="w-40">
          <option value="mrr">Mensualidad</option>
          <option value="salud">Salud (peor primero)</option>
          <option value="silencio">Silencio (más primero)</option>
          <option value="nombre">Nombre</option>
        </FilterSelect>
        <label className="flex h-10 items-center gap-1.5 self-end text-xs text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            name="riesgo"
            value="1"
            defaultChecked={p.riesgo === '1'}
            className="h-4 w-4 accent-[var(--color-brand)]"
          />
          Solo en riesgo
        </label>
        <ToolbarActions hasFilters={hayFiltro} clearHref="/control" />
      </Toolbar>

      {hayFiltro && (
        <p className="text-xs text-[var(--color-text-muted)]">
          {filtrados.length} de {clients.length} clientes · {usd(mrrFiltrado)} de {usd(mrr)} de MRR
          {mrr > 0 && ` (${Math.round((mrrFiltrado / mrr) * 100)}%)`}
        </p>
      )}

      {filtrados.length === 0 ? (
        <EmptyState
          icon="filter_alt_off"
          title="Ningún cliente cumple ese filtro"
          description="Prueba a limpiar alguno. El buscador acepta nombre, marca comercial o identificador."
        />
      ) : (
        <section aria-label="Clientes">
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>Tier</TH>
                <TH>Estado</TH>
                <TH>Onboarding</TH>
                <TH numeric>Salud</TH>
                <TH>Último movimiento</TH>
                <TH numeric>Equipo</TH>
                <TH numeric>Módulos</TH>
                <TH>Ciclo</TH>
                <TH numeric>Instalación</TH>
                <TH numeric>Mensual sin ITBIS</TH>
              </TR>
            </THead>
            <TBody>
              {filtrados.map((c) => {
                const e = extraDe(c)
                const d = dias(e.ultimaActividad)
                return (
                  <TR key={c.slug}>
                    <TD>
                      <Link
                        href={`/control/${c.slug}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {c.legalName}
                      </Link>
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        <Mono>{c.slug}</Mono>
                      </span>
                      {e.bloqueos && (
                        <Badge tone="danger" className="mt-1" title={e.bloqueos}>
                          bloqueado
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <TierBadge tier={c.tier} />
                    </TD>
                    <TD>
                      <StatusBadge status={c.status} />
                    </TD>
                    <TD>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {e.etapaOnboarding
                          ? (ETAPA_LABEL[e.etapaOnboarding] ?? e.etapaOnboarding)
                          : '—'}
                      </span>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular font-semibold ${
                          c.healthScore === null
                            ? 'text-[var(--color-text-muted)]'
                            : c.healthScore < 70
                              ? 'text-[var(--color-semantic-text-danger)]'
                              : c.healthScore < 85
                                ? 'text-[var(--color-semantic-text-warning)]'
                                : 'text-[var(--color-semantic-text-success)]'
                        }`}
                      >
                        {c.healthScore ?? '—'}
                      </span>
                    </TD>
                    <TD>
                      <Silencio d={d} />
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {e.movimientosMes} en 30 d
                      </span>
                    </TD>
                    <TD numeric>
                      <span
                        className="tabular"
                        title={`${e.usuarios} usuarios, ${e.sucursales} sucursales`}
                      >
                        {e.usuarios}u · {e.sucursales}s
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">
                        {c.paidModules}
                        {c.trialModules > 0 && (
                          <span className="text-[var(--color-semantic-text-warning)]">
                            {' '}
                            +{c.trialModules} prueba
                          </span>
                        )}
                      </span>
                    </TD>
                    <TD>{cycleLabel(c.billingCycle)}</TD>
                    <TD numeric>
                      <span className="tabular">{usd(c.installTotal)}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{usd(c.monthlyNet)}</span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </section>
      )}

      <p className="text-xs text-[var(--color-text-muted)]">
        Las cifras las calcula el motor de precios en el momento, con la misma cuenta que emite la
        factura del mes: plan, módulos activos, usuarios, sucursales y empresas de más, archivos,
        descuento del ciclo e ITBIS a los clientes de RD. Lo que{' '}
        <strong className="text-[var(--color-text-secondary)]">todavía no se mide</strong> son las
        transacciones y los consumos por uso: van en cero. El MRR va sin ITBIS, que es de la DGII.
        La actividad sale de la bitácora de auditoría.
      </p>
    </div>
  )
}
