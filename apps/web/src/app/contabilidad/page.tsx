import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  FilterSelect,
  Icon,
  Mono,
  PageHeader,
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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearAsientoForm } from './actions'
import { ESTADOS, ORIGEN_ASIENTO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Asientos · REGB ERP' }

interface EntryRow {
  id: string
  number: string
  entry_date: string
  description: string
  status: string
  source_type: string
  total_debito: string
  lineas: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Asientos contables (modulo 16): borrador, se agregan lineas, se contabiliza. */
export default async function ContabilidadPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; estado?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'accounting')
  const q = (params.q ?? '').trim()
  const estado = params.estado ?? ''
  const hayFiltros = q !== '' || estado !== ''

  const [asientos, totales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const a = await tx<EntryRow[]>`
      select e.id, e.number, e.entry_date::text, e.description, e.status, e.source_type,
             coalesce((select sum(l.debit) from public.journal_entry_lines l
                        where l.entry_id = e.id), 0)::text as total_debito,
             (select count(*) from public.journal_entry_lines l
               where l.entry_id = e.id)::text as lineas
      from public.journal_entries e
      where e.tenant_id = ${ctx.tenantId}
        and (${q} = '' or e.number ilike ${'%' + q + '%'} or e.description ilike ${'%' + q + '%'})
        and (${estado} = '' or e.status = ${estado})
      order by e.entry_date desc, e.number desc
      limit 200`
    const [t] = await tx<{ borradores: string; contabilizados: string }[]>`
      select count(*) filter (where status = 'draft')  as borradores,
             count(*) filter (where status = 'posted') as contabilizados
      from public.journal_entries where tenant_id = ${ctx.tenantId}`
    return [a, t] as const
  })

  const puedeCrear = exigir(ctx, 'accounting', 'accounting.entry.create').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <Shell {...shell} activePath="/contabilidad">
      <div className="space-y-5">
        <PageHeader
          icon="account_balance"
          title="Asientos"
          description="Las ventas, cobros, compras y pagos se contabilizan solos. Un asiento contabilizado es inmutable: se corrige con otro asiento, nunca editandolo."
          actions={
            <>
              <a
                href={`/contabilidad/cuentas${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="account_tree" size={18} />
                Cuentas
              </a>
              <a
                href={`/contabilidad/mapa${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="alt_route" size={18} />
                Mapa
              </a>
              <a
                href={`/contabilidad/mayor${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="menu_book" size={18} />
                Mayor
              </a>
              <a
                href={`/contabilidad/balanza${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="balance" size={18} />
                Balanza
              </a>
            </>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Borradores"
            value={String(totales?.borradores ?? 0)}
            hint="sin contabilizar"
          />
          <StatCard label="Contabilizados" value={String(totales?.contabilizados ?? 0)} />
          <StatCard label="Mostrados" value={String(asientos.length)} />
        </section>

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField defaultValue={q} label="Numero o descripcion" placeholder="AS-2026-00001…" />
          <FilterSelect label="Estado" name="estado" defaultValue={estado}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </FilterSelect>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/contabilidad${qs}`} />
        </Toolbar>

        {asientos.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'account_balance'}
            title={hayFiltros ? 'Ningún asiento coincide' : 'Todavía no hay asientos'}
            description={
              hayFiltros
                ? 'Prueba con otro número o descripción.'
                : 'Crea el primero abajo. Necesitas al menos dos cuentas en el catálogo.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Número</TH>
                <TH>Fecha</TH>
                <TH>Descripción</TH>
                <TH>Origen</TH>
                <TH numeric>Líneas</TH>
                <TH>Estado</TH>
                <TH numeric>Total</TH>
              </TR>
            </THead>
            <TBody>
              {asientos.map((a) => {
                const e = ESTADOS[a.status] ?? { label: a.status, tone: 'neutral' as const }
                return (
                  <TR key={a.id}>
                    <TD>
                      <a
                        href={`/contabilidad/${a.id}${qs}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Mono>{a.number}</Mono>
                      </a>
                    </TD>
                    <TD>{fecha(a.entry_date)}</TD>
                    <TD className="text-[var(--color-text-primary)]">{a.description}</TD>
                    <TD>
                      {a.source_type === 'manual' ? (
                        <span className="text-[var(--color-text-muted)]">Manual</span>
                      ) : (
                        <Badge
                          tone="info"
                          dot={false}
                          title="Generado solo a partir de la operacion"
                        >
                          {ORIGEN_ASIENTO[a.source_type] ?? a.source_type}
                        </Badge>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular">{a.lineas}</span>
                    </TD>
                    <TD>
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(a.total_debito))}</span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo asiento</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearAsientoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input
                    name="entryDate"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input
                    name="description"
                    required
                    minLength={3}
                    placeholder="Venta de contado, compra de suministros…"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Crear borrador
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Se crea en borrador. Le agregas las lineas despues; solo se contabiliza cuando
                debito y crédito cuadran.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
