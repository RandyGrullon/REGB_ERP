import {
  Badge,
  EmptyState,
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
import { TIPOS_ANULACION } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { anularVentaForm } from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cierres · REGB ERP' }

interface SaleRow {
  id: string
  number: string
  ncf: string | null
  total: string
  voided: boolean
  void_reason: string | null
  created_at: string
  customer_name: string | null
  cashier_name: string | null
  warehouse_name: string
  metodos: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const METODO_LABEL: Record<string, string> = {
  cash: 'efectivo',
  card: 'tarjeta',
  transfer: 'transferencia',
}

/** Cierres (S21): el historico de tickets, con anulacion trazable. */
export default async function CierresPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; desde?: string; hasta?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'pos', 'pos.report.view')
  const q = (params.q ?? '').trim()

  // Periodo. Antes las cifras eran de TODA la historia y el dueño leia
  // "Vendido RD$ X" como lo de hoy. Ahora, por defecto, hoy en RD (la fecha
  // fiscal, la misma del 607). Si se busca un ticket por numero sin fechas,
  // se busca en todo el historial: el que vuelve por su ticket de la semana
  // pasada no tiene por que saber que dia fue.
  const fecha = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')
  const desde = fecha(params.desde)
  const hasta = fecha(params.hasta)
  const todoElHistorial = q !== '' && desde === '' && hasta === ''

  const [ventas, totales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const v = await tx<SaleRow[]>`
      select s.id, s.number, s.ncf, s.total::text, s.voided, s.void_reason, s.created_at::text,
             c.name as customer_name, up.display_name as cashier_name,
             w.name as warehouse_name,
             (select string_agg(p.method || ':' || p.amount::text, ',')
                from public.pos_payments p where p.sale_id = s.id) as metodos
      from public.pos_sales s
      join public.pos_shifts sh on sh.id = s.shift_id
      join public.warehouses w on w.id = sh.warehouse_id
      left join public.customers c on c.id = s.customer_id
      left join public.user_profiles up
        on up.tenant_id = s.tenant_id and up.user_id = s.cashier_id
      where s.tenant_id = ${ctx.tenantId}
        and (${q} = '' or s.number ilike ${'%' + q + '%'} or c.name ilike ${'%' + q + '%'})
        and (${todoElHistorial} or public.fecha_fiscal(coalesce(s.sold_at, s.created_at))
             between coalesce(nullif(${desde}, '')::date, public.hoy_fiscal())
                 and coalesce(nullif(${hasta}, '')::date, public.hoy_fiscal()))
      order by s.created_at desc
      limit 200`

    const [t] = await tx<
      { tickets: string; vendido: string; anulados: string; efectivo: string }[]
    >`
      with periodo as (
        select * from public.pos_sales sa
        where sa.tenant_id = ${ctx.tenantId}
          and public.fecha_fiscal(coalesce(sa.sold_at, sa.created_at))
              between coalesce(nullif(${desde}, '')::date, public.hoy_fiscal())
                  and coalesce(nullif(${hasta}, '')::date, public.hoy_fiscal())
      )
      select count(*) filter (where not voided)::text                       as tickets,
             coalesce(sum(total) filter (where not voided), 0)::text        as vendido,
             count(*) filter (where voided)::text                           as anulados,
             coalesce((select sum(p.amount) from public.pos_payments p
                        join periodo sa on sa.id = p.sale_id
                        where not sa.voided and p.method = 'cash'), 0)::text as efectivo
      from periodo`
    return [v, t] as const
  })

  const puedeAnular = exigir(ctx, 'pos', 'pos.void').ok
  const qs = ctx.demoQs
  const esHoy = desde === '' && hasta === ''
  const periodoTexto = esHoy
    ? 'hoy'
    : desde === hasta
      ? `el ${desde.split('-').reverse().join('/')}`
      : `del ${(desde || '…').split('-').reverse().join('/')} al ${(hasta || 'hoy').split('-').reverse().join('/')}`

  const hora = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/pos/reports">
      <div className="space-y-5">
        <PageHeader
          icon="receipt"
          title="Tickets y cierres"
          description="Todo lo vendido en caja. Anular no borra el ticket: lo marca y devuelve la mercancia al almacen."
          crumbs={[{ label: 'Caja', href: `/pos${qs}` }, { label: 'Cierres' }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Tickets"
            value={String(totales?.tickets ?? 0)}
            hint={`vigentes, ${periodoTexto}`}
          />
          <StatCard
            label={esHoy ? 'Vendido hoy' : 'Vendido'}
            value={`RD$ ${money(Number(totales?.vendido ?? 0))}`}
            hint={`sin anulados, ${periodoTexto}`}
          />
          <StatCard
            label="En efectivo"
            value={`RD$ ${money(Number(totales?.efectivo ?? 0))}`}
            hint="del total"
          />
          <StatCard label="Anulados" value={String(totales?.anulados ?? 0)} hint="con motivo" />
        </section>

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField defaultValue={q} label="Ticket o cliente" placeholder="TK-2026-000001…" />
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Desde
            <input
              type="date"
              name="desde"
              defaultValue={desde}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            Hasta
            <input
              type="date"
              name="hasta"
              defaultValue={hasta}
              className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
            />
          </label>
          <ToolbarActions hasFilters={q !== '' || !esHoy} clearHref={`/pos/reports${qs}`} />
        </Toolbar>

        {ventas.length === 0 ? (
          <EmptyState
            icon={q ? 'search_off' : 'receipt'}
            title={q ? 'Ningún ticket coincide' : `No hay ventas ${periodoTexto}`}
            description={
              q
                ? 'Prueba con otro número o cliente.'
                : esHoy
                  ? 'Abre un turno en la caja y haz la primera venta del día, o elige otras fechas arriba.'
                  : 'Prueba con otras fechas.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Ticket</TH>
                <TH>NCF</TH>
                <TH>Cuando</TH>
                <TH>Caja</TH>
                <TH>Cliente</TH>
                <TH>Cajero</TH>
                <TH>Pago</TH>
                <TH numeric>Total</TH>
                {puedeAnular && (
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {ventas.map((v) => (
                <TR key={v.id} className={v.voided ? 'opacity-50' : ''}>
                  <TD>
                    <a
                      href={`/pos/ticket/${v.id}${qs}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Ver e imprimir el ticket"
                      className="text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                    >
                      <Mono>{v.number}</Mono>
                    </a>
                    {v.voided && (
                      <Badge tone="danger" dot={false} className="ml-2" title={v.void_reason ?? ''}>
                        anulado
                      </Badge>
                    )}
                  </TD>
                  <TD>
                    {v.ncf ? (
                      <Mono>{v.ncf}</Mono>
                    ) : (
                      <span
                        title="Este ticket salio sin comprobante fiscal: no hay secuencia de la DGII cargada."
                        className="text-xs text-[var(--color-semantic-text-warning)]"
                      >
                        sin NCF
                      </span>
                    )}
                  </TD>
                  <TD>{hora(v.created_at)}</TD>
                  <TD>{v.warehouse_name}</TD>
                  <TD>{v.customer_name ?? 'Consumidor final'}</TD>
                  <TD>{v.cashier_name ?? '—'}</TD>
                  <TD>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {v.metodos
                        ?.split(',')
                        .map((m) => METODO_LABEL[m.split(':')[0] ?? ''] ?? m)
                        .join(' + ') ?? '—'}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular font-semibold">{money(Number(v.total))}</span>
                  </TD>
                  {puedeAnular && (
                    <TD>
                      {!v.voided && (
                        <form action={anularVentaForm} className="flex items-center gap-1">
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="saleId" value={v.id} />
                          {/* El codigo es lo que se declara en el 608; el
                              texto de al lado es lo que se entiende dentro
                              de seis meses. La DGII no acepta el texto. */}
                          <select
                            name="voidType"
                            required
                            defaultValue=""
                            aria-label={`Motivo DGII para anular ${v.number}`}
                            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                          >
                            <option value="" disabled>
                              Motivo DGII…
                            </option>
                            {Object.entries(TIPOS_ANULACION).map(([codigo, texto]) => (
                              <option key={codigo} value={codigo}>
                                {codigo} · {texto}
                              </option>
                            ))}
                          </select>
                          <input
                            name="reason"
                            required
                            minLength={4}
                            placeholder="Motivo"
                            aria-label={`Motivo para anular ${v.number}`}
                            className="h-8 w-28 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                          />
                          <BotonEnvio
                            aria-label={`Anular ${v.number}`}
                            className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-semantic-text-danger)]"
                          >
                            <Icon name="block" size={16} />
                          </BotonEnvio>
                        </form>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
