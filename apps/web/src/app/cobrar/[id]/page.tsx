import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Icon,
  Mono,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { daysOverdue, lateFeeEligible, TIPOS_ANULACION, type InvoiceStatus } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { ESTADO_FACTURA } from '../estados'
import {
  anularFacturaForm,
  aplicarCargoPorMoraForm,
  emitirNotaDeCreditoForm,
  registrarCobroForm,
  reversarCobroForm,
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
  source_type: string | null
  source_id: string | null
}

interface LineRow {
  id: string
  description: string
  unit: string | null
  qty: string
  unit_price: string
  discount_pct: string
  tax: string
  line_total: string
  devuelto: string
}

interface PaymentRow {
  id: string
  amount: string
  method: string
  reference: string | null
  received_at: string
  received_by_name: string | null
  reversed_at: string | null
  reversal_reason: string | null
  reversed_by_name: string | null
}

interface LateFeeRow {
  id: string
  amount: string
  days_late_at_charge: number
  notes: string | null
  applied_at: string
  applied_by_name: string | null
}

interface NoteRow {
  id: string
  number: string
  kind: string
  ncf: string | null
  total: string
  reason: string
  restocked: boolean
  issue_date: string
  created_by_name: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const METODO_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transf.',
  check: 'Cheque',
  card: 'Tarjeta',
}

const campoCls =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]'

/**
 * Ficha de la factura: sus lineas, cobros (y reversos), cargos por mora,
 * notas de credito, imprimir y anular.
 */
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

  const datos = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<InvoiceHead[]>`
      select i.id, i.number, i.customer_id, c.name as customer_name,
             c.late_fee_exempt as customer_exempt,
             i.issue_date::text, i.due_date::text,
             i.subtotal::text, i.discount::text, i.tax::text,
             i.total::text, i.status, i.ncf, i.ncf_type, i.void_reason, i.notes,
             i.source_type, i.source_id
      from public.customer_invoices i
      join public.customers c on c.id = i.customer_id
      where i.id = ${id} and i.tenant_id = ${ctx.tenantId}`
    if (!h) return null

    const lineas = await tx<LineRow[]>`
      select il.id, il.description, il.unit, il.qty::text, il.unit_price::text,
             il.discount_pct::text, il.tax::text, il.line_total::text,
             coalesce((select sum(nl.qty) from public.customer_credit_note_lines nl
                        where nl.invoice_line_id = il.id), 0)::text as devuelto
      from public.customer_invoice_lines il
      where il.invoice_id = ${id} and il.tenant_id = ${ctx.tenantId}
      order by il.description`

    const pagos = await tx<PaymentRow[]>`
      select cp.id, cp.amount::text, cp.method, cp.reference, cp.received_at::text,
             up.display_name as received_by_name,
             cp.reversed_at::text, cp.reversal_reason,
             ur.display_name as reversed_by_name
      from public.customer_payments cp
      left join public.user_profiles up
        on up.tenant_id = cp.tenant_id and up.user_id = cp.received_by
      left join public.user_profiles ur
        on ur.tenant_id = cp.tenant_id and ur.user_id = cp.reversed_by
      where cp.invoice_id = ${id} and cp.tenant_id = ${ctx.tenantId}
      order by cp.received_at`

    const moras = await tx<LateFeeRow[]>`
      select f.id, f.amount::text, f.days_late_at_charge, f.notes,
             f.applied_at::text,
             up.display_name as applied_by_name
      from public.invoice_late_fees f
      left join public.user_profiles up
        on up.tenant_id = f.tenant_id and up.user_id = f.applied_by
      where f.invoice_id = ${id} and f.tenant_id = ${ctx.tenantId}
      order by f.applied_at`

    const notas = await tx<NoteRow[]>`
      select n.id, n.number, n.kind, n.ncf, n.total::text, n.reason, n.restocked,
             n.issue_date::text, up.display_name as created_by_name
      from public.customer_credit_notes n
      left join public.user_profiles up
        on up.tenant_id = n.tenant_id and up.user_id = n.created_by
      where n.invoice_id = ${id} and n.tenant_id = ${ctx.tenantId}
      order by n.created_at`

    const [s] = await tx<{ saldo: string }[]>`
      select public.invoice_balance(${id})::text as saldo`

    return { h, lineas, pagos, moras, notas, saldo: Number(s?.saldo ?? 0) }
  })

  if (!datos) notFound()
  const { h: head, lineas, pagos, moras, notas, saldo: balance } = datos

  const vigentes = pagos.filter((p) => p.reversed_at === null)
  const cobrado = vigentes.reduce((a, p) => a + Number(p.amount), 0)
  const totalMora = moras.reduce((a, m) => a + Number(m.amount), 0)
  const totalNotas = notas.reduce((a, n) => a + Number(n.total), 0)
  const hoy = new Date()
  const dias = daysOverdue(new Date(`${head.due_date}T12:00:00`), hoy)
  const e = ESTADO_FACTURA[head.status] ?? { label: head.status, tone: 'neutral' as const }
  const anulada = head.status === 'void'

  const puedeCobrar = exigir(ctx, 'ar', 'ar.payment.record').ok
  const puedeAplicarMora = exigir(ctx, 'ar', 'ar.latefee.apply').ok
  const puedeAnular = exigir(ctx, 'ar', 'ar.invoice.void').ok
  const puedeReversar = exigir(ctx, 'ar', 'ar.payment.reverse').ok
  const puedeNota = exigir(ctx, 'ar', 'ar.creditnote.create').ok
  const qs = ctx.demoQs

  const elegibleMora = lateFeeEligible(head.status as InvoiceStatus, head.customer_exempt, dias)
  const devolvibles = lineas.filter((l) => Number(l.qty) - Number(l.devuelto) > 0)
  const ofrecerNota = puedeNota && !anulada && balance > 0

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

  const ocultos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )
  const campos = (
    <>
      {ocultos}
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
              {dias > 0 && balance > 0 && !anulada && (
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
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/cobrar/${head.id}/imprimir${qs}`}
                className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
              >
                <Icon name="print" size={16} />
                Imprimir
              </a>
              {puedeAnular && !anulada && vigentes.length === 0 && notas.length === 0 && (
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
                    title="Con cobros vigentes o notas de credito ya no se anula"
                    className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-semantic-text-danger)] transition-colors hover:bg-[var(--color-surface-raised)]"
                  >
                    <Icon name="cancel" size={16} />
                    Anular
                  </BotonEnvio>
                </form>
              )}
            </div>
          }
        />

        <section aria-label="Totales" className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          <StatCard label="Subtotal" value={`RD$ ${money(Number(head.subtotal))}`} hint="sin ITBIS" />
          <StatCard label="ITBIS" value={`RD$ ${money(Number(head.tax))}`} />
          <StatCard
            label="Total"
            value={`RD$ ${money(Number(head.total) + totalMora)}`}
            hint={totalMora > 0 ? `incl. RD$ ${money(totalMora)} de mora` : 'capital + mora'}
          />
          <StatCard label="Cobrado" value={`RD$ ${money(cobrado)}`} hint="sin reversados" />
          <StatCard label="Notas de credito" value={`RD$ ${money(totalNotas)}`} />
          <StatCard
            label="Saldo"
            value={`RD$ ${money(balance)}`}
            hint={balance <= 0 ? 'saldada' : 'pendiente'}
          />
        </section>

        {(puedeCobrar || puedeAplicarMora) && !anulada && (balance > 0 || elegibleMora) && (
          <Card>
            <CardHeader>
              <CardTitle>Acciones</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-wrap items-center gap-4">
              {puedeCobrar && balance > 0 && (
                <form action={registrarCobroForm} className="flex flex-wrap items-center gap-1">
                  {campos}
                  <input
                    name="amount"
                    defaultValue={balance.toFixed(2)}
                    inputMode="decimal"
                    aria-label="Monto a cobrar"
                    title={totalMora > 0 ? 'El saldo incluye la mora' : undefined}
                    className="tabular h-9 w-28 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-sm text-[var(--color-text-primary)]"
                  />
                  <select name="method" aria-label="Forma de pago" className={campoCls}>
                    <option value="cash">Efectivo</option>
                    <option value="transfer">Transf.</option>
                    <option value="check">Cheque</option>
                    <option value="card">Tarjeta</option>
                  </select>
                  <input
                    name="reference"
                    placeholder="Referencia"
                    aria-label="Referencia del cobro"
                    className={`${campoCls} w-32`}
                  />
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="payments" size={16} />
                    Registrar cobro
                  </BotonEnvio>
                </form>
              )}

              {puedeAplicarMora && elegibleMora && (
                <form
                  action={aplicarCargoPorMoraForm}
                  className="flex flex-wrap items-center gap-1"
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
                    className={`${campoCls} w-40`}
                  />
                  <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm text-[var(--color-semantic-text-warning)] hover:bg-[var(--color-surface-raised)]">
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
            <CardTitle>Detalle</CardTitle>
          </CardHeader>
          <CardBody>
            {lineas.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Esta factura es anterior a las lineas de factura: su detalle esta en el pedido de
                origen.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Descripcion</TH>
                    <TH numeric>Cantidad</TH>
                    <TH numeric>Precio</TH>
                    <TH numeric>ITBIS</TH>
                    <TH numeric>Total</TH>
                    <TH numeric>Devuelto</TH>
                  </TR>
                </THead>
                <TBody>
                  {lineas.map((l) => (
                    <TR key={l.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        {l.description}
                        {Number(l.discount_pct) > 0 && (
                          <span className="block text-[11px] text-[var(--color-semantic-text-warning)]">
                            -{Number(l.discount_pct)}%
                          </span>
                        )}
                      </TD>
                      <TD numeric>
                        <span className="tabular">
                          {Number(l.qty)} {l.unit ?? ''}
                        </span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(l.unit_price))}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(l.tax))}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular font-semibold">{money(Number(l.line_total))}</span>
                      </TD>
                      <TD numeric>
                        <span className="tabular text-[var(--color-text-muted)]">
                          {Number(l.devuelto) > 0 ? Number(l.devuelto) : '—'}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

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
                    {puedeReversar && (
                      <TH>
                        <span className="sr-only">Reversar</span>
                      </TH>
                    )}
                  </TR>
                </THead>
                <TBody>
                  {pagos.map((p) => {
                    const reversado = p.reversed_at !== null
                    return (
                      <TR key={p.id}>
                        <TD>{fechaHora(p.received_at)}</TD>
                        <TD>{METODO_LABEL[p.method] ?? p.method}</TD>
                        <TD>
                          {p.reference ?? '—'}
                          {reversado && (
                            <span className="block text-[11px] text-[var(--color-text-muted)]">
                              Reversado {fechaHora(p.reversed_at!)}
                              {p.reversed_by_name ? ` por ${p.reversed_by_name}` : ''}: {p.reversal_reason}
                            </span>
                          )}
                        </TD>
                        <TD>{p.received_by_name ?? '—'}</TD>
                        <TD numeric>
                          {reversado ? (
                            <span className="tabular text-[var(--color-text-muted)] line-through">
                              {money(Number(p.amount))}
                            </span>
                          ) : (
                            <span className="tabular text-[var(--color-semantic-text-success)]">
                              {money(Number(p.amount))}
                            </span>
                          )}
                        </TD>
                        {puedeReversar && (
                          <TD>
                            {reversado ? (
                              <Badge tone="neutral" dot={false}>
                                Reversado
                              </Badge>
                            ) : (
                              !anulada && (
                                <form action={reversarCobroForm} className="flex items-center gap-1">
                                  {ocultos}
                                  <input type="hidden" name="paymentId" value={p.id} />
                                  <input
                                    name="reason"
                                    required
                                    minLength={4}
                                    placeholder="Motivo"
                                    aria-label={`Motivo para reversar el cobro de ${money(Number(p.amount))}`}
                                    className="h-8 w-32 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                                  />
                                  <BotonEnvio
                                    title="No se borra: queda tachado, con el motivo y quien lo hizo"
                                    className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-semantic-text-danger)] transition-colors hover:bg-[var(--color-surface-raised)]"
                                  >
                                    Reversar
                                  </BotonEnvio>
                                </form>
                              )
                            )}
                          </TD>
                        )}
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {(notas.length > 0 || ofrecerNota) && (
          <Card>
            <CardHeader>
              <CardTitle>Notas de credito</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {notas.length > 0 && (
                <Table>
                  <THead>
                    <TR>
                      <TH>Nota</TH>
                      <TH>Fecha</TH>
                      <TH>Tipo</TH>
                      <TH>Motivo</TH>
                      <TH numeric>Monto</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {notas.map((n) => (
                      <TR key={n.id}>
                        <TD>
                          <Mono>{n.number}</Mono>
                          <span className="block text-[11px] text-[var(--color-text-muted)]">
                            {n.ncf ?? 'sin NCF'}
                          </span>
                        </TD>
                        <TD>{fecha(n.issue_date)}</TD>
                        <TD>
                          {n.kind === 'return' ? 'Devolucion' : 'Rebaja'}
                          {n.restocked && (
                            <span className="block text-[11px] text-[var(--color-text-muted)]">
                              repuso inventario
                            </span>
                          )}
                        </TD>
                        <TD>
                          {n.reason}
                          {n.created_by_name && (
                            <span className="block text-[11px] text-[var(--color-text-muted)]">
                              {n.created_by_name}
                            </span>
                          )}
                        </TD>
                        <TD numeric>
                          <span className="tabular font-semibold">{money(Number(n.total))}</span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}

              {ofrecerNota && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {devolvibles.length > 0 && (
                    <form
                      action={emitirNotaDeCreditoForm}
                      className="space-y-2 rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] p-3"
                    >
                      {campos}
                      <input type="hidden" name="kind" value="return" />
                      <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                        Devolucion de mercancia
                      </p>
                      {devolvibles.map((l) => {
                        const quedan = Number(l.qty) - Number(l.devuelto)
                        return (
                          <label
                            key={l.id}
                            className="flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {l.description}{' '}
                              <span className="text-[var(--color-text-muted)]">(hasta {quedan})</span>
                            </span>
                            <input
                              name={`qty_${l.id}`}
                              inputMode="decimal"
                              placeholder="0"
                              aria-label={`Cantidad que se devuelve de ${l.description}`}
                              className="tabular h-8 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-xs text-[var(--color-text-primary)]"
                            />
                          </label>
                        )
                      })}
                      <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                        <input type="checkbox" name="restock" value="1" defaultChecked />
                        Reponer inventario (vuelve al almacen del pedido)
                      </label>
                      <input
                        name="reason"
                        required
                        minLength={4}
                        placeholder="Motivo (ej.: devolvio 2 sin abrir)"
                        aria-label="Motivo de la devolucion"
                        className={`${campoCls} w-full`}
                      />
                      <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                        <Icon name="assignment_return" size={16} />
                        Emitir nota de credito
                      </BotonEnvio>
                    </form>
                  )}

                  <form
                    action={emitirNotaDeCreditoForm}
                    className="space-y-2 rounded-[var(--radius-md)] bg-[var(--color-surface-overlay)] p-3"
                  >
                    {campos}
                    <input type="hidden" name="kind" value="adjustment" />
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                      Rebaja de monto
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Con ITBIS incluido: se separa en base e impuesto como en la factura. Hasta RD${' '}
                      {money(balance)}.
                    </p>
                    <input
                      name="amount"
                      required
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label="Monto de la rebaja, con ITBIS"
                      className={`${campoCls} tabular w-32 text-right`}
                    />
                    <input
                      name="reason"
                      required
                      minLength={4}
                      placeholder="Motivo (ej.: rayon en la caja)"
                      aria-label="Motivo de la rebaja"
                      className={`${campoCls} w-full`}
                    />
                    <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-link)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="percent" size={16} />
                      Emitir rebaja
                    </BotonEnvio>
                  </form>
                </div>
              )}
              {ofrecerNota && head.ncf && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Lleva NCF B04 y el NCF de esta factura ({head.ncf}) como comprobante modificado.
                  Necesita una secuencia B04 autorizada en Comprobantes.
                </p>
              )}
            </CardBody>
          </Card>
        )}

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

        {anulada && head.void_reason && (
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
