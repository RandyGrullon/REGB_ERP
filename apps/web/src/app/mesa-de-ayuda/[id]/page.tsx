import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import { slaVigente, transicionValidaTicket, type EstadoTicket } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { agregarMensajeForm, transicionarTicketForm } from '../actions'
import { ESTADO_TICKET, PRIORIDAD_TICKET } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface TicketHead {
  id: string
  subject: string
  description: string
  customer_name: string | null
  priority: string
  status: EstadoTicket
  sla_due_at: string | null
  satisfaction_rating: number | null
}

interface Mensaje {
  id: string
  author_type: string
  body: string
  created_at: string
}

const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'closed') return 'neutral'
  if (s === 'resolved') return 'success'
  if (s === 'waiting_customer') return 'warning'
  return 'neutral'
}

/** Detalle de un ticket (modulo 40): su hilo de mensajes y su maquina de estados. */
export default async function TicketDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'helpdesk')

  const { head, mensajes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<TicketHead[]>`
      select tk.id, tk.subject, tk.description, c.name as customer_name, tk.priority, tk.status,
             tk.sla_due_at::text, tk.satisfaction_rating
      from public.tickets tk
      left join public.customers c on c.id = tk.customer_id
      where tk.id = ${id} and tk.tenant_id = ${ctx.tenantId}`
    const m = await tx<Mensaje[]>`
      select id, author_type, body, created_at::text
      from public.ticket_messages where tenant_id = ${ctx.tenantId} and ticket_id = ${id}
      order by created_at asc`
    return { head: h ?? null, mensajes: m }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'helpdesk', 'helpdesk.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="ticketId" value={head.id} />
    </>
  )
  const vencido =
    head.status !== 'closed' &&
    head.status !== 'resolved' &&
    !slaVigente(head.sla_due_at ? new Date(head.sla_due_at) : null, new Date())

  return (
    <Shell {...shell} activePath="/mesa-de-ayuda">
      <div className="space-y-5">
        <PageHeader
          icon="support_agent"
          title={head.subject}
          crumbs={[{ label: 'Mesa de ayuda', href: `/mesa-de-ayuda${qs}` }, { label: head.subject }]}
          actions={<Badge tone={badgeEstado(head.status)}>{ESTADO_TICKET[head.status] ?? head.status}</Badge>}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Cliente" value={head.customer_name ?? 'Sin cliente'} />
          <StatCard label="Prioridad" value={PRIORIDAD_TICKET[head.priority] ?? head.priority} />
          <StatCard label="SLA" value={vencido ? 'Vencido' : head.sla_due_at ? new Date(head.sla_due_at).toLocaleString('es-DO') : '—'} />
          <StatCard label="Satisfaccion" value={head.satisfaction_rating ? `${head.satisfaction_rating}/5` : '—'} />
        </section>

        <p className="text-xs text-[var(--color-text-muted)]">{head.description}</p>

        {puedeGestionar && head.status !== 'closed' && (
          <div className="flex flex-wrap items-end gap-2">
            {transicionValidaTicket(head.status, 'in_progress' as EstadoTicket) && (
              <form action={transicionarTicketForm}>
                {campos}
                <input type="hidden" name="siguiente" value="in_progress" />
                <BotonEnvio  className={botonClase}>
                  <Icon name="autorenew" size={14} />
                  {head.status === 'open' ? 'Tomar' : 'Reabrir'}
                </BotonEnvio>
              </form>
            )}
            {transicionValidaTicket(head.status, 'waiting_customer' as EstadoTicket) && (
              <form action={transicionarTicketForm}>
                {campos}
                <input type="hidden" name="siguiente" value="waiting_customer" />
                <BotonEnvio  className={botonSecundarioClase}>
                  Esperar al cliente
                </BotonEnvio>
              </form>
            )}
            {transicionValidaTicket(head.status, 'resolved' as EstadoTicket) && (
              <form action={transicionarTicketForm} className="flex items-end gap-2">
                {campos}
                <input type="hidden" name="siguiente" value="resolved" />
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Satisfaccion
                  <select
                    name="satisfaction"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Sin calificar</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio  className={botonClase}>
                  <Icon name="check_circle" size={14} />
                  Resolver
                </BotonEnvio>
              </form>
            )}
            {transicionValidaTicket(head.status, 'closed' as EstadoTicket) && (
              <form action={transicionarTicketForm}>
                {campos}
                <input type="hidden" name="siguiente" value="closed" />
                <BotonEnvio  className={botonSecundarioClase}>
                  Cerrar
                </BotonEnvio>
              </form>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Conversacion</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-3">
              {mensajes.length === 0 && <li className="text-xs text-[var(--color-text-muted)]">Todavia no hay mensajes.</li>}
              {mensajes.map((m) => (
                <li key={m.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5">
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">
                    {m.author_type === 'agent' ? 'Agente' : 'Cliente'}
                    <span className="ml-2 font-normal text-[var(--color-text-muted)]">
                      {new Date(m.created_at).toLocaleString('es-DO')}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{m.body}</p>
                </li>
              ))}
            </ul>

            {puedeGestionar && head.status !== 'closed' && (
              <form action={agregarMensajeForm} className="mt-4 flex items-end gap-2">
                {campos}
                <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Responder
                  <input
                    name="body"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio  className={botonClase}>
                  <Icon name="send" size={14} />
                  Enviar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
