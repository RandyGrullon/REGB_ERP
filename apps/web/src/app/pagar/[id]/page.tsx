import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { daysOverdue } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADO_FACTURA } from '../estados'
import { anularFacturaForm, registrarPagoForm } from '../actions'

export const dynamic = 'force-dynamic'

interface InvoiceHead {
  id: string
  supplier_invoice_number: string
  supplier_name: string
  issue_date: string
  due_date: string
  subtotal: string
  tax: string
  retention_amount: string
  total: string
  status: string
  supplier_ncf: string | null
  void_reason: string | null
  notes: string | null
}

interface PaymentRow {
  id: string
  amount: string
  method: string
  reference: string | null
  paid_at: string
  paid_by_name: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const METODO_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transf.',
  check: 'Cheque',
  card: 'Tarjeta',
}

/** Ficha de la factura de proveedor: historial de pagos y anular. */
export default async function FacturaProveedorDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'ap')

  const [head, pagos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<InvoiceHead[]>`
      select i.id, i.supplier_invoice_number, s.name as supplier_name,
             i.issue_date::text, i.due_date::text,
             i.subtotal::text, i.tax::text, i.retention_amount::text, i.total::text,
             i.status, i.supplier_ncf, i.void_reason, i.notes
      from public.supplier_invoices i
      join public.suppliers s on s.id = i.supplier_id
      where i.id = ${id} and i.tenant_id = ${ctx.tenantId}`
    if (!h) return [null, []] as const

    const p = await tx<PaymentRow[]>`
      select sp.id, sp.amount::text, sp.method, sp.reference,
             sp.paid_at::text, up.display_name as paid_by_name
      from public.supplier_payments sp
      left join public.user_profiles up
        on up.tenant_id = sp.tenant_id and up.user_id = sp.paid_by
      where sp.invoice_id = ${id} and sp.tenant_id = ${ctx.tenantId}
      order by sp.paid_at`

    return [h, p] as const
  })

  if (!head) notFound()

  const [saldoRow] = await asUser(ctx.userId, ctx.tenantId, (tx) =>
    tx<{ saldo: string }[]>`select public.ap_invoice_balance(${id})::text as saldo`,
  )
  const saldo = Number(saldoRow?.saldo ?? 0)
  const pagado = pagos.reduce((a, p) => a + Number(p.amount), 0)
  const hoy = new Date()
  const dias = daysOverdue(new Date(`${head.due_date}T12:00:00`), hoy)
  const e = ESTADO_FACTURA[head.status] ?? { label: head.status, tone: 'neutral' as const }

  const puedePagar = exigir(ctx, 'ap', 'ap.payment.record').ok
  const puedeAnular = exigir(ctx, 'ap', 'ap.invoice.void').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  const fechaHora = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="invoiceId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/pagar">
      <div className="space-y-5">
        <PageHeader
          icon="request_page"
          title={head.supplier_invoice_number}
          description={`${head.supplier_name}${head.supplier_ncf ? ` · ${head.supplier_ncf}` : ''}`}
          crumbs={[
            { label: 'Por pagar', href: `/pagar${qs}` },
            { label: head.supplier_invoice_number },
          ]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={e.tone}>{e.label}</Badge>
              <span className="text-xs text-[var(--color-text-muted)]">
                Emitida {fecha(head.issue_date)} · Vence {fecha(head.due_date)}
              </span>
              {dias > 0 && saldo > 0 && head.status !== 'void' && (
                <Badge tone="danger" dot={false}>
                  {dias} dias de atraso
                </Badge>
              )}
            </div>
          }
          actions={
            puedeAnular &&
            head.status !== 'void' &&
            pagos.length === 0 && (
              <form action={anularFacturaForm} className="flex flex-wrap items-center gap-1">
                {campos}
                <input
                  name="reason"
                  required
                  minLength={4}
                  placeholder="Motivo"
                  aria-label="Motivo para anular"
                  className="h-9 w-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                />
                <button
                  type="submit"
                  title="Una factura con pagos no se anula: se corrige con un ajuste aparte"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] transition-colors hover:bg-[var(--color-surface-raised)]"
                >
                  <Icon name="cancel" size={16} />
                  Anular
                </button>
              </form>
            )
          }
        />

        <section aria-label="Totales" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Subtotal" value={`RD$ ${money(Number(head.subtotal))}`} hint="sin ITBIS" />
          <StatCard label="ITBIS" value={`RD$ ${money(Number(head.tax))}`} />
          <StatCard
            label="Total"
            value={`RD$ ${money(Number(head.total))}`}
            hint={
              Number(head.retention_amount) > 0
                ? `incl. RD$ ${money(Number(head.retention_amount))} retenido`
                : undefined
            }
          />
          <StatCard label="Pagado" value={`RD$ ${money(pagado)}`} />
          <StatCard
            label="Saldo"
            value={`RD$ ${money(saldo)}`}
            hint={saldo <= 0 ? 'saldada' : 'pendiente'}
          />
        </section>

        {puedePagar && saldo > 0 && head.status !== 'void' && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar pago</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarPagoForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto
                  <input
                    name="amount"
                    defaultValue={saldo.toFixed(2)}
                    inputMode="decimal"
                    aria-label="Monto a pagar"
                    className="tabular h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-right text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Forma
                  <select
                    name="method"
                    aria-label="Forma de pago"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    <option value="transfer">Transf.</option>
                    <option value="check">Cheque</option>
                    <option value="cash">Efectivo</option>
                    <option value="card">Tarjeta</option>
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Referencia
                  <input
                    name="reference"
                    aria-label="Referencia del pago"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="payments" size={18} />
                  Registrar pago
                </button>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Pagos</CardTitle>
          </CardHeader>
          <CardBody>
            {pagos.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Todavia no se ha registrado ningun pago.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Forma</TH>
                    <TH>Referencia</TH>
                    <TH>Pagado por</TH>
                    <TH numeric>Monto</TH>
                  </TR>
                </THead>
                <TBody>
                  {pagos.map((p) => (
                    <TR key={p.id}>
                      <TD>{fechaHora(p.paid_at)}</TD>
                      <TD>{METODO_LABEL[p.method] ?? p.method}</TD>
                      <TD>{p.reference ?? '—'}</TD>
                      <TD>{p.paid_by_name ?? '—'}</TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-semantic-text-success)]">
                          {money(Number(p.amount))}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {head.status === 'void' && head.void_reason && (
          <Card>
            <CardBody className="text-sm text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">Anulada:</strong>{' '}
              {head.void_reason}
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
