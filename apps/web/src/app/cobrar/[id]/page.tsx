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
import { daysOverdue, lateFeeEligible, TIPOS_ANULACION } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADO_FACTURA } from '../estados'
import {
  anularFacturaForm,
  aplicarCargoPorMoraForm,
  registrarCobroForm,
} from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface InvoiceHead {
  id: string
  number: string
  customer_id: string
  customer_name: string
  customer_exempt: boolean
  issue_date: string
  due_date: string
  subtotal: string
  discount: string
  tax: string
  total: string
  status: string
  ncf: string | null
  ncf_type: string | null
  void_reason: string | null
  notes: string | null
}

interface PaymentRow {
  id: string
  amount: string
  method: string
  reference: string | null
  received_at: string
  received_by_name: string | null
}

interface LateFeeRow {
  id: string
  amount: string
  days_late_at_charge: number
  notes: string | null
  applied_at: string
  applied_by_name: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const METODO_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transf.',
  check: 'Cheque',
  card: 'Tarjeta',
}

/** Ficha de la factura: historial de cobros y cargos por mora, y anular. */
export default async function FacturaDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'ar')

  const [head, pagos, moras] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<InvoiceHead[]>`
      select i.id, i.number, i.customer_id, c.name as customer_name,
             c.late_fee_exempt as customer_exempt,
             i.issue_date::text, i.due_date::text,
             i.subtotal::text, i.discount::text, i.tax::text,
             i.total::text, i.status, i.ncf, i.ncf_type, i.void_reason, i.notes
      from public.customer_invoices i
      join public.customers c on c.id = i.customer_id
      where i.id = ${id} and i.tenant_id = ${ctx.tenantId}`
    if (!h) return [null, [], []] as const

    const p = await tx<PaymentRow[]>`
      select cp.id, cp.amount::text, cp.method, cp.reference,
             cp.received_at::text,
             up.display_name as received_by_name
      from public.customer_payments cp
      left join public.user_profiles up
        on up.tenant_id = cp.tenant_id and up.user_id = cp.received_by
      where cp.invoice_id = ${id} and cp.tenant_id = ${ctx.tenantId}
      order by cp.received_at`

    const m = await tx<LateFeeRow[]>`
      select f.id, f.amount::text, f.days_late_at_charge, f.notes,
             f.applied_at::text,
             up.display_name as applied_by_name
      from public.invoice_late_fees f
      left join public.user_profiles up
        on up.tenant_id = f.tenant_id and up.user_id = f.applied_by
      where f.invoice_id = ${id} and f.tenant_id = ${ctx.tenantId}
      order by f.applied_at`

    return [h, p, m] as const
  })

  if (!head) notFound()

  const [saldo] = await asUser(ctx.userId, ctx.tenantId, (tx) =>
    tx<{ saldo: string }[]>`select public.invoice_balance(${id})::text as saldo`,
  )
  const balance = Number(saldo?.saldo ?? 0)

  const cobrado = pagos.reduce((a, p) => a + Number(p.amount), 0)
  const totalMora = moras.reduce((a, m) => a + Number(m.amount), 0)
  const hoy = new Date()
  const dias = daysOverdue(new Date(`${head.due_date}T12:00:00`), hoy)
  const e = ESTADO_FACTURA[head.status] ?? { label: head.status, tone: 'neutral' as const }

  const puedeCobrar = exigir(ctx, 'ar', 'ar.payment.record').ok
  const puedeAplicarMora = exigir(ctx, 'ar', 'ar.latefee.apply').ok
  const puedeAnular = exigir(ctx, 'ar', 'ar.invoice.void').ok
  const qs = ctx.demoQs

  const elegibleMora = lateFeeEligible(
    head.status as 'open' | 'partially_paid' | 'paid' | 'overdue' | 'void',
    head.customer_exempt,
    dias,
  )

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  const fechaHora = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="invoiceId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/cobrar">
      <div className="space-y-5">
        <PageHeader
          icon="request_quote"
          title={head.number}
          description={`${head.customer_name}${head.ncf ? ` · ${head.ncf_type} ${head.ncf}` : ' · sin NCF'}`}
          crumbs={[{ label: 'Por cobrar', href: `/cobrar${qs}` }, { label: head.number }]}
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={e.tone}>{e.label}</Badge>
              <span className="text-xs text-[var(--color-text-muted)]">
                Emitida {fecha(head.issue_date)} · Vence {fecha(head.due_date)}
              </span>
              {dias > 0 && balance > 0 && head.status !== 'void' && (
                <Badge tone="danger" dot={false}>
                  {dias} dias de atraso
                </Badge>
              )}
              {head.customer_exempt && (
                <Badge tone="neutral" dot={false} title="No genera cargo por mora">
                  Cliente exento de mora
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
                <select
                  name="voidType"
                  required
                  defaultValue=""
                  aria-label="Motivo DGII para anular"
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
                  aria-label="Motivo para anular"
                  className="h-9 w-32 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                />
                <BotonEnvio
                  
                  title="Una factura con cobros no se anula: se emite nota de credito"
                  className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] transition-colors hover:bg-[var(--color-surface-raised)]">
                  <Icon name="cancel" size={16} />
                  Anular
                </BotonEnvio>
              </form>
            )
          }
        />

        <section aria-label="Totales" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Subtotal" value={`RD$ ${money(Number(head.subtotal))}`} hint="sin ITBIS" />
          <StatCard label="ITBIS" value={`RD$ ${money(Number(head.tax))}`} />
          <StatCard
            label="Total"
            value={`RD$ ${money(Number(head.total) + totalMora)}`}
            hint={totalMora > 0 ? `incl. RD$ ${money(totalMora)} de mora` : 'capital + mora'}
          />
          <StatCard label="Cobrado" value={`RD$ ${money(cobrado)}`} />
          <StatCard
            label="Saldo"
            value={`RD$ ${money(balance)}`}
            hint={balance <= 0 ? 'saldada' : 'pendiente'}
          />
        </section>

        {(puedeCobrar || puedeAplicarMora) && head.status !== 'void' && (
          <Card>
            <CardHeader>
              <CardTitle>Acciones</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-wrap items-center gap-4">
              {puedeCobrar && balance > 0 && (
                <form action={registrarCobroForm} className="flex items-center gap-1">
                  {campos}
                  <input
                    name="amount"
                    defaultValue={balance.toFixed(2)}
                    inputMode="decimal"
                    aria-label="Monto a cobrar"
                    className="tabular h-9 w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-sm text-[var(--color-text-primary)]"
                  />
                  <select
                    name="method"
                    aria-label="Forma de pago"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    <option value="cash">Efectivo</option>
                    <option value="transfer">Transf.</option>
                    <option value="check">Cheque</option>
                    <option value="card">Tarjeta</option>
                  </select>
                  <input
                    name="reference"
                    placeholder="Referencia"
                    aria-label="Referencia del cobro"
                    className="h-9 w-32 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  />
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="payments" size={16} />
                    Registrar cobro
                  </BotonEnvio>
                </form>
              )}

              {puedeAplicarMora && elegibleMora && (
                <form
                  action={aplicarCargoPorMoraForm}
                  className="flex items-center gap-1"
                  title={`${dias} dias de atraso — el monto lo decides tu, no hay calculo automatico`}
                >
                  {campos}
                  <input
                    name="amount"
                    placeholder="0.00"
                    inputMode="decimal"
                    aria-label="Cargo por mora"
                    className="tabular h-9 w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-sm text-[var(--color-text-primary)]"
                  />
                  <input
                    name="notes"
                    placeholder="Notas (opcional)"
                    aria-label="Notas del cargo por mora"
                    className="h-9 w-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  />
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-semantic-text-warning)] hover:bg-[var(--color-surface-raised)]">
                    <Icon name="schedule" size={16} />
                    Aplicar cargo por mora
                  </BotonEnvio>
                </form>
              )}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Cobros</CardTitle>
          </CardHeader>
          <CardBody>
            {pagos.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Todavia no se ha registrado ningun cobro.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Forma</TH>
                    <TH>Referencia</TH>
                    <TH>Recibido por</TH>
                    <TH numeric>Monto</TH>
                  </TR>
                </THead>
                <TBody>
                  {pagos.map((p) => (
                    <TR key={p.id}>
                      <TD>{fechaHora(p.received_at)}</TD>
                      <TD>{METODO_LABEL[p.method] ?? p.method}</TD>
                      <TD>{p.reference ?? '—'}</TD>
                      <TD>{p.received_by_name ?? '—'}</TD>
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

        {moras.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Cargos por mora</CardTitle>
            </CardHeader>
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH numeric>Dias de atraso al aplicar</TH>
                    <TH>Notas</TH>
                    <TH>Aplicado por</TH>
                    <TH numeric>Monto</TH>
                  </TR>
                </THead>
                <TBody>
                  {moras.map((m) => (
                    <TR key={m.id}>
                      <TD>{fechaHora(m.applied_at)}</TD>
                      <TD numeric>
                        <span className="tabular">{m.days_late_at_charge}</span>
                      </TD>
                      <TD>{m.notes ?? '—'}</TD>
                      <TD>{m.applied_by_name ?? '—'}</TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-semantic-text-warning)]">
                          {money(Number(m.amount))}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        )}

        {head.status === 'void' && head.void_reason && (
          <Card>
            <CardBody className="text-sm text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">Anulada:</strong>{' '}
              {head.void_reason}
            </CardBody>
          </Card>
        )}

        {head.notes && (
          <Card>
            <CardBody className="text-sm text-[var(--color-text-secondary)]">
              <strong className="text-[var(--color-text-primary)]">Notas:</strong> {head.notes}
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
