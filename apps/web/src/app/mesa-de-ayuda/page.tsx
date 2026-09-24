import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
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
import { slaVigente } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearTicketForm } from './actions'
import { ESTADO_TICKET, PRIORIDAD_TICKET } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mesa de ayuda · REGB ERP' }

interface TicketRow {
  id: string
  subject: string
  customer_name: string | null
  priority: string
  status: string
  sla_due_at: string | null
}

interface ClienteOption {
  id: string
  name: string
}

const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'closed') return 'neutral'
  if (s === 'resolved') return 'success'
  if (s === 'waiting_customer') return 'warning'
  return 'neutral'
}

/** Mesa de ayuda (modulo 40): resuelto se puede reabrir, cerrado es terminal de verdad. */
export default async function MesaDeAyudaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'helpdesk')

  const { tickets, clientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const t = await tx<TicketRow[]>`
      select tk.id, tk.subject, c.name as customer_name, tk.priority, tk.status, tk.sla_due_at::text
      from public.tickets tk
      left join public.customers c on c.id = tk.customer_id
      where tk.tenant_id = ${ctx.tenantId}
      order by tk.created_at desc`
    const cl = await tx<ClienteOption[]>`
      select id, name from public.customers where tenant_id = ${ctx.tenantId} order by name limit 300`
    return { tickets: t, clientes: cl }
  })

  const abiertos = tickets.filter((t) => t.status !== 'closed' && t.status !== 'resolved').length
  const vencidos = tickets.filter(
    (t) =>
      t.status !== 'closed' &&
      t.status !== 'resolved' &&
      !slaVigente(t.sla_due_at ? new Date(t.sla_due_at) : null, new Date()),
  ).length
  const puedeGestionar = exigir(ctx, 'helpdesk', 'helpdesk.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/mesa-de-ayuda">
      <div className="space-y-5">
        <PageHeader
          icon="support_agent"
          title="Mesa de ayuda"
          description="Un ticket resuelto se puede reabrir si el problema sigue. Uno cerrado es terminal de verdad."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Abiertos" value={String(abiertos)} />
          <StatCard label="Con SLA vencido" value={String(vencidos)} />
        </section>

        {tickets.length === 0 ? (
          <EmptyState
            icon="support_agent"
            title="Todavia no hay ningun ticket"
            description="Crea el primero abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Asunto</TH>
                <TH>Cliente</TH>
                <TH>Prioridad</TH>
                <TH>SLA</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {tickets.map((t) => {
                const vencido =
                  t.status !== 'closed' &&
                  t.status !== 'resolved' &&
                  !slaVigente(t.sla_due_at ? new Date(t.sla_due_at) : null, new Date())
                return (
                  <TR key={t.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <a
                        href={`/mesa-de-ayuda/${t.id}${qs}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {t.subject}
                      </a>
                    </TD>
                    <TD className="text-[var(--color-text-muted)]">
                      {t.customer_name ?? 'Sin cliente'}
                    </TD>
                    <TD className="text-[var(--color-text-muted)]">
                      {PRIORIDAD_TICKET[t.priority] ?? t.priority}
                    </TD>
                    <TD>
                      {t.sla_due_at ? (
                        <span
                          className={
                            vencido
                              ? 'text-[var(--color-semantic-text-danger)]'
                              : 'text-[var(--color-text-muted)]'
                          }
                        >
                          {vencido ? 'Vencido' : new Date(t.sla_due_at).toLocaleString('es-DO')}
                        </span>
                      ) : (
                        <Mono>—</Mono>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={badgeEstado(t.status)}>
                        {ESTADO_TICKET[t.status] ?? t.status}
                      </Badge>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo ticket</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearTicketForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente (opcional)
                  <select
                    name="customerId"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Sin cliente</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Asunto
                  <input
                    name="subject"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Prioridad
                  <select
                    name="priority"
                    defaultValue="normal"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="low">Baja</option>
                    <option value="normal">Normal</option>
                    <option value="high">Alta</option>
                    <option value="urgent">Urgente</option>
                  </select>
                </label>
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input
                    name="description"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
