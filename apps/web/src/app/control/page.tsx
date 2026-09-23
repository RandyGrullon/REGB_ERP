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
 * Todo sale de datos reales. Lo que todavia no se mide (consumo por
 * usuario, storage facturable) se dice que no se mide, en vez de ensenar
 * un cero que parece un dato.
 */

const TIER_LABEL = { pyme: 'PYME', mediano: 'Mediano', grande: 'Grande' } as const
const ETAPA_LABEL: Record<string, string> = {
  sold: 'Vendido',
  migration: 'Migracion',
  config: 'Configuracion',
  training: 'Capacitacion',
  live: 'En produccion',
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
    <span className={tono} title={`Ultimo movimiento hace ${d} dias`}>
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
    return b.monthlyTotal - a.monthlyTotal
  })

  const mrrFiltrado = filtrados.reduce((a, c) => a + c.monthlyTotal, 0)
  const hayFiltro = Boolean(p.q || p.tier || p.estado || p.ciclo || p.etapa || p.riesgo)
  const riesgosos = clients.filter(enRiesgo)
  const enPrueba = clients.reduce((a, c) => a + c.trialModules, 0)
  const modulosDePago = clients.reduce((a, c) => a + c.paidModules, 0)

  return (
    <div className="space-y-5">
      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="MRR" value={usd(mrr)} hint="mensualidad de todos" />
        <StatCard label="ARR" value={usd(mrr * 12)} hint="anualizado" />
        <StatCard label="Clientes" value={String(clients.length)} hint="sin archivar" />
        <StatCard
          label="Modulos de pago"
          value={String(modulosDePago)}
          hint={enPrueba > 0 ? `+ ${enPrueba} en prueba` : 'ninguno en prueba'}
        />
        <StatCard
          label="Requieren atencion"
          value={String(riesgosos.length)}
          hint="mora, silencio o salud baja"
        />
      </section>

      {solicitudes.length > 0 && (
        <section
          aria-label="Solicitudes de activacion"
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
            {solicitudes.length === 1 ? '' : 'n'} activar modulos
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Es lo unico de este panel donde alguien esta diciendo que quiere pagarte mas. Llamalo
            hoy: la cotizacion que vio esta guardada, asi que la conversacion arranca del mismo
            numero.
          </p>
          <ul className="mt-3 space-y-2">
            {solicitudes.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[var(--color-border-subtle)] pt-2 text-sm first:border-0 first:pt-0"
              >
                <Link
                  href={`/control/${s.slug}`}
                  className="font-medium text-[var(--color-text-link)] hover:underline"
                >
                  {s.tenant}
                </Link>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {s.modulos.join(', ')}
                </span>
                <span className="tabular text-xs text-[var(--color-text-muted)]">
                  {usd(s.mensual)}/mes + {usd(s.instalacion)} de instalacion
                </span>
                <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                  hace {Math.max(0, dias(s.desde) ?? 0)} d
                </span>
                {s.nota && (
                  <span className="w-full text-xs italic text-[var(--color-text-secondary)]">
                    &ldquo;{s.nota}&rdquo;
                  </span>
                )}
                <span className="flex w-full flex-wrap gap-2 pt-1">
                  <form action={activarSolicitud}>
                    <input type="hidden" name="id" value={s.id} />
                    <BotonEnvio
                      
                      title="Enciende los modulos en prueba de 14 dias y avisa al cliente"
                      className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                      <Icon name="rocket_launch" size={14} />
                      Activar en prueba
                    </BotonEnvio>
                  </form>
                  <form action={marcarContactada}>
                    <input type="hidden" name="id" value={s.id} />
                    <BotonEnvio
                      
                      title="Ya lo llamaste; sale de la lista sin activar nada"
                      className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                      <Icon name="call" size={14} />
                      Ya lo llame
                    </BotonEnvio>
                  </form>
                  <form action={descartarSolicitud} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={s.id} />
                    <input
                      name="motivo"
                      placeholder="motivo"
                      aria-label="Motivo para descartar la solicitud"
                      className="h-8 w-32 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                    />
                    <BotonEnvio
                      
                      className="flex h-8 items-center gap-1 rounded-full px-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-semantic-text-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                      Descartar
                    </BotonEnvio>
                  </form>
                </span>
              </li>
            ))}
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
            cliente{riesgosos.length === 1 ? '' : 's'} en mora, en silencio hace mas de 14 dias, con
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
        <SearchField name="q" defaultValue={p.q ?? ''} placeholder="Nombre, marca o slug…" />
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
          {['trial', 'active', 'past_due', 'readonly', 'suspended'].map((s) => (
            <option key={s} value={s}>
              {s}
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
          <option value="silencio">Silencio (mas primero)</option>
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
          title="Ningun cliente cumple ese filtro"
          description="Prueba a limpiar alguno. El buscador acepta nombre, marca comercial o slug."
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
                <TH>Ultimo movimiento</TH>
                <TH numeric>Equipo</TH>
                <TH numeric>Modulos</TH>
                <TH>Ciclo</TH>
                <TH numeric>Instalacion</TH>
                <TH numeric>Mensualidad</TH>
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
                      <span className="tabular font-semibold">{usd(c.monthlyTotal)}</span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </section>
      )}

      <p className="text-xs text-[var(--color-text-muted)]">
        Las cifras las calcula el motor de precios en el momento a partir de los modulos activos
        (§6.4): no hay montos guardados que se puedan quedar viejos. El{' '}
        <strong className="text-[var(--color-text-secondary)]">consumo real</strong> (usuarios
        facturables, storage, transacciones) todavia no se mide — <Mono>regb.usage_meters</Mono>{' '}
        esta vacia — asi que el precio mostrado es plan + modulos, sin excedentes. La actividad sale
        de la bitacora de auditoria, que es el unico rastro fiable de uso que existe hoy.
      </p>
    </div>
  )
}
