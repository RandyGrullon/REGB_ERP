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
import { daysOverdue, lateFeeEligible } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  alternarExentoMoraForm,
  aplicarCargoPorMoraForm,
  facturarPedidoForm,
  marcarVencidasForm,
  registrarCobroForm,
} from './actions'
import { ESTADO_FACTURA } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Por cobrar · REGB ERP' }

interface InvoiceRow {
  id: string
  number: string
  customer_name: string
  customer_exempt: boolean
  issue_date: string
  due_date: string
  total: string
  mora: string
  cobrado: string
  saldo: string
  status: string
}

interface CustomerExemptRow {
  id: string
  name: string
  payment_terms: number
  late_fee_exempt: boolean
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Cuentas por cobrar (S22): quien debe, cuanto y desde cuando. */
export default async function CobrarPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; estado?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ar')
  const q = (params.q ?? '').trim()
  const estado = params.estado ?? ''
  const hayFiltros = q !== '' || estado !== ''

  const [facturas, porFacturar, totales, clientesExentos] = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
    const f = await tx<InvoiceRow[]>`
        select i.id, i.number, c.name as customer_name, c.late_fee_exempt as customer_exempt,
               i.issue_date::text, i.due_date::text, i.total::text, i.status,
               coalesce((select sum(fe.amount) from public.invoice_late_fees fe
                          where fe.invoice_id = i.id), 0)::text as mora,
               coalesce((select sum(p.amount) from public.customer_payments p
                          where p.invoice_id = i.id), 0)::text as cobrado,
               public.invoice_balance(i.id)::text as saldo
        from public.customer_invoices i
        join public.customers c on c.id = i.customer_id
        where i.tenant_id = ${ctx.tenantId}
          and (${q} = '' or i.number ilike ${'%' + q + '%'} or c.name ilike ${'%' + q + '%'})
          and (${estado} = '' or i.status = ${estado})
        order by i.due_date, i.number
        limit 200`

    // Pedidos entregados que aun no se han facturado: el hueco por donde
    // se escapa el dinero en un negocio a credito.
    const pf = await tx<{ id: string; number: string; customer_name: string; total: string }[]>`
        select o.id, o.number, c.name as customer_name, o.total::text
        from public.sales_orders o
        join public.customers c on c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.status in ('delivered','partially_delivered')
          and not exists (select 1 from public.customer_invoices i
                           where i.source_type = 'sales_order' and i.source_id = o.id
                             and i.status <> 'void')
        order by o.order_date limit 20`

    const [t] = await tx<{ porcobrar: string; vencido: string; facturas: string }[]>`
        select
          coalesce(sum(public.invoice_balance(id)) filter
            (where status in ('open','partially_paid','overdue')), 0)::text as porcobrar,
          coalesce(sum(public.invoice_balance(id)) filter
            (where status = 'overdue'), 0)::text                            as vencido,
          count(*) filter (where status in ('open','partially_paid','overdue'))::text as facturas
        from public.customer_invoices where tenant_id = ${ctx.tenantId}`

    // Solo importa para quien vende a credito: de contado no hay plazo que
    // incumplir, asi que no tiene sentido marcarlo exento de algo que nunca
    // le va a aplicar.
    const ce = await tx<CustomerExemptRow[]>`
        select id, name, payment_terms, late_fee_exempt
        from public.customers
        where tenant_id = ${ctx.tenantId} and is_active and payment_terms > 0
        order by name`

    return [f, pf, t, ce] as const
  })

  const puedeFacturar = exigir(ctx, 'ar', 'ar.invoice.create').ok
  const puedeCobrar = exigir(ctx, 'ar', 'ar.payment.record').ok
  const puedeAplicarMora = exigir(ctx, 'ar', 'ar.latefee.apply').ok
  const qs = ctx.demoQs
  const hoy = new Date()

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <Shell {...shell} activePath="/cobrar">
      <div className="space-y-5">
        <PageHeader
          icon="request_quote"
          title="Cuentas por cobrar"
          description="Quien te debe, cuanto y desde cuando. El saldo se calcula de total menos cobrado: nunca se guarda a mano."
          actions={
            <>
              <a
                href={`/cobrar/cartera${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="monitoring" size={18} />
                Cartera
              </a>
              <form action={marcarVencidasForm}>
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <button
                  type="submit"
                  title="Marca vencidas las que pasaron su fecha. Se puede pulsar las veces que sea."
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="update" size={18} />
                  Actualizar vencidas
                </button>
              </form>
            </>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Por cobrar"
            value={`RD$ ${money(Number(totales?.porcobrar ?? 0))}`}
            hint={`${totales?.facturas ?? 0} facturas abiertas`}
          />
          <StatCard
            label="Vencido"
            value={`RD$ ${money(Number(totales?.vencido ?? 0))}`}
            hint="paso su fecha"
          />
          <StatCard
            label="Sin facturar"
            value={String(porFacturar.length)}
            hint="pedidos entregados"
          />
        </section>

        {porFacturar.length > 0 && puedeFacturar && (
          <Card>
            <CardHeader>
              <CardTitle>Pedidos entregados sin facturar</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {porFacturar.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] px-3 py-2"
                >
                  <Mono>{o.number}</Mono>
                  <span className="flex-1 text-sm text-[var(--color-text-primary)]">
                    {o.customer_name}
                  </span>
                  <span className="tabular text-sm font-semibold text-[var(--color-text-primary)]">
                    RD$ {money(Number(o.total))}
                  </span>
                  <form action={facturarPedidoForm}>
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <input type="hidden" name="orderId" value={o.id} />
                    <button
                      type="submit"
                      className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                    >
                      <Icon name="receipt_long" size={16} />
                      Facturar
                    </button>
                  </form>
                </div>
              ))}
              <p className="text-xs text-[var(--color-text-muted)]">
                El vencimiento sale de los dias de credito que el cliente tiene hoy.
              </p>
            </CardBody>
          </Card>
        )}

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField defaultValue={q} label="Factura o cliente" placeholder="FA-2026-00001…" />
          <FilterSelect label="Estado" name="estado" defaultValue={estado}>
            <option value="">Todas</option>
            {Object.entries(ESTADO_FACTURA).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </FilterSelect>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/cobrar${qs}`} />
        </Toolbar>

        {facturas.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'request_quote'}
            title={hayFiltros ? 'Ninguna factura coincide' : 'Todavia no hay facturas'}
            description={
              hayFiltros
                ? 'Prueba con otro numero o cliente.'
                : 'Entrega un pedido y facturalo desde aqui para empezar a llevar la cartera.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Factura</TH>
                <TH>Cliente</TH>
                <TH>Emitida</TH>
                <TH>Vence</TH>
                <TH numeric>Total</TH>
                <TH numeric>Cobrado</TH>
                <TH numeric>Saldo</TH>
                <TH>Estado</TH>
                {(puedeCobrar || puedeAplicarMora) && (
                  <TH>
                    <span className="sr-only">Cobrar / mora</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {facturas.map((f) => {
                const e = ESTADO_FACTURA[f.status] ?? { label: f.status, tone: 'neutral' as const }
                const saldo = Number(f.saldo)
                const dias = daysOverdue(new Date(`${f.due_date}T12:00:00`), hoy)
                return (
                  <TR key={f.id} className={f.status === 'void' ? 'opacity-50' : ''}>
                    <TD>
                      <Mono>{f.number}</Mono>
                    </TD>
                    <TD className="font-medium text-[var(--color-text-primary)]">
                      {f.customer_name}
                    </TD>
                    <TD>{fecha(f.issue_date)}</TD>
                    <TD>
                      {fecha(f.due_date)}
                      {dias > 0 && saldo > 0 && f.status !== 'void' && (
                        <span className="block text-[10px] text-[var(--color-semantic-text-danger)]">
                          {dias} dias de atraso
                        </span>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(f.total))}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-success)]">
                        {money(Number(f.cobrado))}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(saldo)}</span>
                      {Number(f.mora) > 0 && (
                        <span className="block text-[10px] text-[var(--color-semantic-text-warning)]">
                          incl. {money(Number(f.mora))} mora
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </TD>
                    {(puedeCobrar || puedeAplicarMora) && (
                      <TD>
                        <div className="flex flex-col items-start gap-1">
                          {puedeCobrar && saldo > 0 && f.status !== 'void' && (
                            <form action={registrarCobroForm} className="flex items-center gap-1">
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="invoiceId" value={f.id} />
                              <input
                                name="amount"
                                defaultValue={saldo.toFixed(2)}
                                inputMode="decimal"
                                aria-label={`Monto a cobrar de ${f.number}`}
                                className="tabular h-8 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-xs text-[var(--color-text-primary)]"
                              />
                              <select
                                name="method"
                                aria-label="Forma de pago"
                                className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-1 text-xs text-[var(--color-text-primary)]"
                              >
                                <option value="cash">Efectivo</option>
                                <option value="transfer">Transf.</option>
                                <option value="check">Cheque</option>
                                <option value="card">Tarjeta</option>
                              </select>
                              <button
                                type="submit"
                                aria-label={`Registrar cobro de ${f.number}`}
                                className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--color-brand-bright)] transition-colors hover:bg-[var(--color-brand-soft)]"
                              >
                                <Icon name="payments" size={18} />
                              </button>
                            </form>
                          )}
                          {puedeAplicarMora &&
                            lateFeeEligible(
                              f.status as 'open' | 'partially_paid' | 'paid' | 'overdue' | 'void',
                              f.customer_exempt,
                              dias,
                            ) && (
                              <form
                                action={aplicarCargoPorMoraForm}
                                className="flex items-center gap-1"
                                title={`${dias} dias de atraso — el monto lo decides tu, no hay calculo automatico`}
                              >
                                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                                <input type="hidden" name="invoiceId" value={f.id} />
                                <input
                                  name="amount"
                                  placeholder="0.00"
                                  inputMode="decimal"
                                  aria-label={`Cargo por mora de ${f.number}`}
                                  className="tabular h-8 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-xs text-[var(--color-text-primary)]"
                                />
                                <button
                                  type="submit"
                                  aria-label={`Aplicar cargo por mora a ${f.number}`}
                                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--color-semantic-text-warning)] transition-colors hover:bg-[var(--color-surface-raised)]"
                                >
                                  <Icon name="schedule" size={18} />
                                </button>
                              </form>
                            )}
                        </div>
                      </TD>
                    )}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeAplicarMora && clientesExentos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Clientes exentos de mora</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                Un cliente marcado aqui nunca genera cargo por mora, aunque pague tarde. Es una
                decision fija: no cambia sola por como pague.
              </p>
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {clientesExentos.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-[var(--color-text-primary)]">
                      {c.name}
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                        {c.payment_terms} dias de credito
                      </span>
                    </span>
                    <form action={alternarExentoMoraForm}>
                      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)]"
                      >
                        {c.late_fee_exempt ? (
                          <Badge tone="neutral" dot={false}>
                            Exento — quitar
                          </Badge>
                        ) : (
                          'Marcar exento'
                        )}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
