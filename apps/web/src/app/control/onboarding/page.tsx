import Link from 'next/link'
import { Icon } from '@regb/ui'
import { db } from '@/lib/db'
import { requireProvider } from '@/lib/provider-guard'
import { TIERS } from './alta'
import {
  alternarTamano,
  conteoPorTamano,
  filtrarTarjetas,
  leerFiltro,
  queryDeFiltro,
  TAMANO_TEXTO,
  type TarjetaOnboarding,
} from './tablero'
import { TableroKanban } from './TableroKanban'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Onboarding · REGB Control' }

/**
 * Kanban de onboarding (S17): cada cliente nuevo recorre
 * vendido → migración → configuración → capacitación → en vivo.
 *
 * Los clientes sin fila se registran en 'sold' al cargar (idempotente):
 * ningun cliente puede existir fuera del tablero.
 *
 * El filtro -nombre, identificador o RNC, y tamaño- vive en la URL
 * (`?q=...&tamano=pyme,grande`) y se aplica aqui, en el servidor: el enlace
 * se comparte y sobrevive a recargar. Mover tarjetas es cosa del cliente
 * (TableroKanban).
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; tamano?: string | string[] }>
}) {
  await requireProvider()
  const filtro = leerFiltro(await searchParams)
  const sql = db()

  await sql`
    insert into regb.onboarding (tenant_id, stage)
    select t.id, case when t.go_live_at is not null then 'live' else 'sold' end
    from regb.tenants t
    where t.status <> 'archived'
      and not exists (select 1 from regb.onboarding o where o.tenant_id = t.id)`

  const todas = await sql<TarjetaOnboarding[]>`
    select o.tenant_id, t.slug, t.legal_name, t.trade_name, t.tax_id, t.tier::text as tier,
           o.stage, o.blockers,
           exists (
             select 1 from public.user_invitations i
             join public.roles r on r.id = i.role_id and r.name = 'Owner'
             where i.tenant_id = t.id and i.status = 'pending'
           ) as dueno_pendiente
    from regb.onboarding o
    join regb.tenants t on t.id = o.tenant_id
    where t.status <> 'archived'
    order by t.legal_name`

  const visibles = filtrarTarjetas(todas, filtro)
  const conteo = conteoPorTamano(todas, filtro)
  const hayFiltro = filtro.q !== '' || filtro.tamanos.length > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Miga de pan" className="text-sm text-[var(--color-text-muted)]">
          <Link href="/control" className="text-[var(--color-text-link)] hover:underline">
            Clientes
          </Link>{' '}
          › Onboarding
        </nav>
        <Link
          href="/control/onboarding/nuevo"
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
        >
          <Icon name="person_add" size={18} />
          Dar de alta un cliente
        </Link>
      </div>

      <section aria-label="Filtros del tablero" className="flex flex-wrap items-center gap-3">
        <form
          method="get"
          role="search"
          className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md"
        >
          <label htmlFor="buscar-cliente" className="sr-only">
            Buscar cliente por nombre, identificador o RNC
          </label>
          <span className="relative min-w-0 flex-1">
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              id="buscar-cliente"
              name="q"
              type="search"
              defaultValue={filtro.q}
              maxLength={80}
              placeholder="Nombre, identificador o RNC"
              className="h-11 w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface-input)] pl-9 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            />
          </span>
          {/* El tamaño elegido viaja con la busqueda: no se pierde al buscar. */}
          {filtro.tamanos.length > 0 && (
            <input type="hidden" name="tamano" value={filtro.tamanos.join(',')} />
          )}
          <button
            type="submit"
            className="inline-flex h-11 items-center rounded-full bg-[var(--color-surface-raised)] px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
          >
            Buscar
          </button>
        </form>

        <nav aria-label="Filtrar por tamaño" className="flex flex-wrap items-center gap-2">
          {TIERS.map((t) => {
            const activo = filtro.tamanos.includes(t)
            return (
              <Link
                key={t}
                href={`/control/onboarding${queryDeFiltro(alternarTamano(filtro, t))}`}
                aria-label={`${TAMANO_TEXTO[t]}: ${conteo[t]} ${conteo[t] === 1 ? 'cliente' : 'clientes'}${activo ? ', filtro activo (quitar)' : ''}`}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] ${
                  activo
                    ? 'bg-[var(--color-brand)] text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
                    : 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {activo && <Icon name="check" size={14} />}
                {TAMANO_TEXTO[t]}
                <span className="tabular opacity-80">{conteo[t]}</span>
              </Link>
            )
          })}
          {hayFiltro && (
            <Link
              href="/control/onboarding"
              className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
            >
              <Icon name="close" size={14} />
              Quitar filtros
            </Link>
          )}
        </nav>
      </section>

      {hayFiltro && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Mostrando {visibles.length} de {todas.length}{' '}
          {todas.length === 1 ? 'cliente' : 'clientes'}
          {filtro.q !== '' && <> · búsqueda &ldquo;{filtro.q}&rdquo;</>}
          {filtro.tamanos.length > 0 && (
            <> · tamaño {filtro.tamanos.map((t) => TAMANO_TEXTO[t]).join(' o ')}</>
          )}
          .
        </p>
      )}

      <TableroKanban tarjetas={visibles} hayFiltro={hayFiltro} />

      <p className="text-xs text-[var(--color-text-muted)]">
        Llegar a &quot;En vivo&quot; fija la fecha en que el cliente empezó a operar, y volver atrás
        no la borra. Ningún cliente existe fuera del tablero: los nuevos entran solos en
        &quot;Vendido&quot;.
      </p>
    </div>
  )
}
