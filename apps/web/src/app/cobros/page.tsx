import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import {
  cancelarLinkForm,
  confirmarPagoForm,
  correrRecurrentesForm,
  crearLinkForm,
  crearRecurrenteForm,
} from './actions'
import { ESTADO_LINK, FRECUENCIA_LABEL, GATEWAY_LABEL } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cobros · REGB ERP' }

interface LinkRow {
  id: string
  customer_name: string | null
  amount: string
  description: string
  status: string
  gateway: string
  expires_at: string | null
  created_at: string
}

interface RecurrenteRow {
  id: string
  customer_name: string
  amount: string
  description: string
  frequency: string
  next_charge_date: string
  is_active: boolean
}

interface ClienteOption {
  id: string
  name: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Pasarelas de cobro (modulo 27): links de cobro y cobro recurrente, confirmados a mano. */
export default async function CobrosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'payments')

  const [links, recurrentes, clientes] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const l = await tx<LinkRow[]>`
      select pl.id, c.name as customer_name, pl.amount::text, pl.description, pl.status,
             pl.gateway, pl.expires_at::text, pl.created_at::text
      from public.payment_links pl
      left join public.customers c on c.id = pl.customer_id
      where pl.tenant_id = ${ctx.tenantId}
      order by pl.created_at desc
      limit 100`

    const r = await tx<RecurrenteRow[]>`
      select rc.id, c.name as customer_name, rc.amount::text, rc.description, rc.frequency,
             rc.next_charge_date::text, rc.is_active
      from public.recurring_charges rc
      join public.customers c on c.id = rc.customer_id
      where rc.tenant_id = ${ctx.tenantId}
      order by rc.next_charge_date`

    const c = await tx<ClienteOption[]>`
      select id, name from public.customers
      where tenant_id = ${ctx.tenantId} and is_active order by name`

    return [l, r, c] as const
  })

  const pendientes = links.filter((l) => l.status === 'pending')
  const totalPendiente = pendientes.reduce((a, l) => a + Number(l.amount), 0)
  const totalPagado = links.filter((l) => l.status === 'paid').reduce((a, l) => a + Number(l.amount), 0)

  const puedeCrear = exigir(ctx, 'payments', 'payments.link.create').ok
  const puedeConfirmar = exigir(ctx, 'payments', 'payments.link.confirm').ok
  const puedeRecurrente = exigir(ctx, 'payments', 'payments.recurring.create').ok
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
    </>
  )

  return (
    <Shell {...shell} activePath="/cobros">
      <div className="space-y-5">
        <PageHeader
          icon="payments"
          title="Cobros"
          description="Links de cobro y cobro recurrente. Sin pasarela real conectada: confirmar el pago es siempre una decision manual, igual que un cobro de cuentas por cobrar."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Pendiente" value={`RD$ ${money(totalPendiente)}`} hint={`${pendientes.length} links`} />
          <StatCard label="Pagado" value={`RD$ ${money(totalPagado)}`} />
          <StatCard label="Cobros recurrentes" value={String(recurrentes.filter((r) => r.is_active).length)} />
        </section>

        {links.length === 0 ? (
          <EmptyState
            icon="payments"
            title="Todavia no se ha generado ningun link de cobro"
            description="Genera el primero abajo, con su monto y su descripcion."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Descripcion</TH>
                <TH>Cliente</TH>
                <TH numeric>Monto</TH>
                <TH>Pasarela</TH>
                <TH>Estado</TH>
                <TH>Vence</TH>
                {(puedeConfirmar) && (
                  <TH>
                    <span className="sr-only">Acciones</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {links.map((l) => {
                const e = ESTADO_LINK[l.status] ?? { label: l.status, tone: 'neutral' as const }
                return (
                  <TR key={l.id} className={l.status === 'canceled' ? 'opacity-50' : ''}>
                    <TD className="text-[var(--color-text-primary)]">{l.description}</TD>
                    <TD>{l.customer_name ?? '—'}</TD>
                    <TD numeric>
                      <span className="tabular">{money(Number(l.amount))}</span>
                    </TD>
                    <TD>{GATEWAY_LABEL[l.gateway] ?? l.gateway}</TD>
                    <TD>
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </TD>
                    <TD>{l.expires_at ? fecha(l.expires_at) : '—'}</TD>
                    {puedeConfirmar && (
                      <TD>
                        {l.status === 'pending' && (
                          <div className="flex items-center gap-2">
                            <form action={confirmarPagoForm} className="flex items-center gap-1">
                              {campos}
                              <input type="hidden" name="linkId" value={l.id} />
                              <input
                                name="paidAmount"
                                defaultValue={l.amount}
                                inputMode="decimal"
                                aria-label={`Monto pagado de ${l.description}`}
                                className="tabular h-8 w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-right text-xs text-[var(--color-text-primary)]"
                              />
                              <BotonEnvio
                                
                                aria-label={`Confirmar pago de ${l.description}`}
                                title="Confirma que el pago ya llego -manual, sin pasarela real conectada-"
                                className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-brand-bright)] transition-colors hover:bg-[var(--color-brand-soft)]">
                                <Icon name="check_circle" size={18} />
                              </BotonEnvio>
                            </form>
                            <form action={cancelarLinkForm}>
                              {campos}
                              <input type="hidden" name="linkId" value={l.id} />
                              <BotonEnvio
                                
                                aria-label={`Cancelar ${l.description}`}
                                className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)]">
                                <Icon name="cancel" size={18} />
                              </BotonEnvio>
                            </form>
                          </div>
                        )}
                      </TD>
                    )}
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Generar link de cobro</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearLinkForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente (opcional)
                  <select name="customerId" defaultValue="" className={claseInput}>
                    <option value="">Sin cliente asociado</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input name="description" required minLength={3} placeholder="Anticipo del pedido" className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Vence
                  <input name="expiresAt" type="date" className={claseInput} />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add_link" size={18} />
                  Generar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Cobros recurrentes</CardTitle>
          </CardHeader>
          <CardBody>
            {recurrentes.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Todavia no hay ningun cobro recurrente configurado.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Cliente</TH>
                    <TH>Descripcion</TH>
                    <TH numeric>Monto</TH>
                    <TH>Frecuencia</TH>
                    <TH>Proximo cobro</TH>
                  </TR>
                </THead>
                <TBody>
                  {recurrentes.map((r) => (
                    <TR key={r.id} className={r.is_active ? '' : 'opacity-50'}>
                      <TD className="text-[var(--color-text-primary)]">{r.customer_name}</TD>
                      <TD>{r.description}</TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(r.amount))}</span>
                      </TD>
                      <TD>{FRECUENCIA_LABEL[r.frequency] ?? r.frequency}</TD>
                      <TD>{fecha(r.next_charge_date)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {puedeRecurrente && (
              <form action={correrRecurrentesForm} className="mt-3">
                {campos}
                <BotonEnvio
                  
                  title="Genera un link por cada cobro recurrente ya vencido"
                  className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="event_repeat" size={16} />
                  Generar cobros vencidos
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        {puedeRecurrente && clientes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Configurar cobro recurrente</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearRecurrenteForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente
                  <select name="customerId" required className={claseInput}>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input name="description" required minLength={3} placeholder="Mantenimiento mensual" className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Frecuencia
                  <select name="frequency" defaultValue="monthly" className={claseInput}>
                    <option value="weekly">Semanal</option>
                    <option value="monthly">Mensual</option>
                    <option value="yearly">Anual</option>
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Proximo cobro
                  <input name="nextChargeDate" type="date" required className={claseInput} />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="add" size={18} />
                  Configurar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
