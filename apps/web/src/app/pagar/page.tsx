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
import { daysOverdue } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { marcarVencidasForm, registrarFacturaForm, registrarPagoForm } from './actions'
import { ESTADO_FACTURA } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Por pagar · REGB ERP' }

interface InvoiceRow {
  id: string
  supplier_invoice_number: string
  supplier_name: string
  issue_date: string
  due_date: string
  total: string
  retencion: string
  pagado: string
  saldo: string
  status: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Cuentas por pagar (modulo 18): a quien le debemos, cuanto y desde cuando. */
export default async function PagarPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { q?: string; estado?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'ap')
  const q = (params.q ?? '').trim()
  const estado = params.estado ?? ''
  const hayFiltros = q !== '' || estado !== ''

  const [facturas, proveedores, totales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const f = await tx<InvoiceRow[]>`
        select i.id, i.supplier_invoice_number, s.name as supplier_name,
               i.issue_date::text, i.due_date::text, i.total::text,
               i.retention_amount::text as retencion, i.status,
               coalesce((select sum(p.amount) from public.supplier_payments p
                          where p.invoice_id = i.id), 0)::text as pagado,
               public.ap_invoice_balance(i.id)::text as saldo
        from public.supplier_invoices i
        join public.suppliers s on s.id = i.supplier_id
        where i.tenant_id = ${ctx.tenantId}
          and (${q} = '' or i.supplier_invoice_number ilike ${'%' + q + '%'}
               or s.name ilike ${'%' + q + '%'})
          and (${estado} = '' or i.status = ${estado})
        order by i.due_date, i.supplier_invoice_number
        limit 200`
    const s = await tx<{ id: string; name: string; payment_terms: number }[]>`
        select id, name, payment_terms from public.suppliers
        where tenant_id = ${ctx.tenantId} and is_active order by name`
    const [t] = await tx<{ porpagar: string; vencido: string; facturas: string }[]>`
        select
          coalesce(sum(public.ap_invoice_balance(id)) filter
            (where status in ('open','partially_paid','overdue')), 0)::text as porpagar,
          coalesce(sum(public.ap_invoice_balance(id)) filter
            (where status = 'overdue'), 0)::text                            as vencido,
          count(*) filter (where status in ('open','partially_paid','overdue'))::text as facturas
        from public.supplier_invoices where tenant_id = ${ctx.tenantId}`
    return [f, s, t] as const
  })

  const puedeCrear = exigir(ctx, 'ap', 'ap.invoice.create').ok
  const puedePagar = exigir(ctx, 'ap', 'ap.payment.record').ok
  const qs = ctx.demoQs
  const hoy = new Date()

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <Shell {...shell} activePath="/pagar">
      <div className="space-y-5">
        <PageHeader
          icon="request_page"
          title="Cuentas por pagar"
          description="A quien le debemos, cuanto y desde cuando. La retencion reduce lo que se le paga al proveedor -esa parte va a la DGII-."
          actions={
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
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Por pagar"
            value={`RD$ ${money(Number(totales?.porpagar ?? 0))}`}
            hint={`${totales?.facturas ?? 0} facturas abiertas`}
          />
          <StatCard
            label="Vencido"
            value={`RD$ ${money(Number(totales?.vencido ?? 0))}`}
            hint="paso su fecha"
          />
          <StatCard label="Proveedores" value={String(proveedores.length)} hint="activos" />
        </section>

        <Toolbar hidden={qs ? { tenant: ctx.tenantSlug, rol: ctx.roleName } : {}}>
          <SearchField defaultValue={q} label="Numero o proveedor" placeholder="F-001, Distribuidora…" />
          <FilterSelect label="Estado" name="estado" defaultValue={estado}>
            <option value="">Todas</option>
            {Object.entries(ESTADO_FACTURA).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </FilterSelect>
          <ToolbarActions hasFilters={hayFiltros} clearHref={`/pagar${qs}`} />
        </Toolbar>

        {facturas.length === 0 ? (
          <EmptyState
            icon={hayFiltros ? 'search_off' : 'request_page'}
            title={hayFiltros ? 'Ninguna factura coincide' : 'Todavia no hay facturas de proveedor'}
            description={
              hayFiltros
                ? 'Prueba con otro numero o proveedor.'
                : 'Registra la primera abajo. Necesitas al menos un proveedor activo.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Factura</TH>
                <TH>Proveedor</TH>
                <TH>Emitida</TH>
                <TH>Vence</TH>
                <TH numeric>Total</TH>
                <TH numeric>Pagado</TH>
                <TH numeric>Saldo</TH>
                <TH>Estado</TH>
                {puedePagar && (
                  <TH>
                    <span className="sr-only">Pagar</span>
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
                      <a
                        href={`/pagar/${f.id}${qs}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        <Mono>{f.supplier_invoice_number}</Mono>
                      </a>
                    </TD>
                    <TD className="font-medium text-[var(--color-text-primary)]">
                      {f.supplier_name}
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
                      {Number(f.retencion) > 0 && (
                        <span className="block text-[10px] text-[var(--color-semantic-text-warning)]">
                          -{money(Number(f.retencion))} retenido
                        </span>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular text-[var(--color-semantic-text-success)]">
                        {money(Number(f.pagado))}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(saldo)}</span>
                    </TD>
                    <TD>
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </TD>
                    {puedePagar && (
                      <TD>
                        {saldo > 0 && f.status !== 'void' && (
                          <form action={registrarPagoForm} className="flex items-center gap-1">
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="invoiceId" value={f.id} />
                            <input
                              name="amount"
                              defaultValue={saldo.toFixed(2)}
                              inputMode="decimal"
                              aria-label={`Monto a pagar de ${f.supplier_invoice_number}`}
                              className="tabular h-8 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-xs text-[var(--color-text-primary)]"
                            />
                            <select
                              name="method"
                              aria-label="Forma de pago"
                              className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-1 text-xs text-[var(--color-text-primary)]"
                            >
                              <option value="transfer">Transf.</option>
                              <option value="check">Cheque</option>
                              <option value="cash">Efectivo</option>
                              <option value="card">Tarjeta</option>
                            </select>
                            <button
                              type="submit"
                              aria-label={`Registrar pago de ${f.supplier_invoice_number}`}
                              className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] text-[var(--color-brand-bright)] transition-colors hover:bg-[var(--color-brand-soft)]"
                            >
                              <Icon name="payments" size={18} />
                            </button>
                          </form>
                        )}
                      </TD>
                    )}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeCrear && proveedores.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar factura de proveedor</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarFacturaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Proveedor
                  <select
                    name="supplierId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {proveedores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  No. de factura
                  <input
                    name="supplierInvoiceNumber"
                    required
                    placeholder="F-001"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  NCF (opcional)
                  <input
                    name="supplierNcf"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Subtotal
                  <input
                    name="subtotal"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  ITBIS
                  <input
                    name="tax"
                    inputMode="decimal"
                    defaultValue="0"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Retencion
                  <input
                    name="retention"
                    inputMode="decimal"
                    defaultValue="0"
                    title="Se captura a mano: no hay formula fija de cuando aplica ni de cuanto."
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="add" size={18} />
                  Registrar
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                El vencimiento sale de los dias de credito que ese proveedor te da a ti. La
                retencion se escribe a mano — no hay calculo automatico.
              </p>
            </CardBody>
          </Card>
        )}

        {proveedores.length === 0 && (
          <Card>
            <CardBody className="pt-4 text-sm text-[var(--color-text-secondary)]">
              Necesitas al menos un proveedor activo para registrar facturas.{' '}
              <a
                href={`/compras/proveedores${qs}`}
                className="text-[var(--color-text-link)] hover:underline"
              >
                Registra el primero
              </a>
              .
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
