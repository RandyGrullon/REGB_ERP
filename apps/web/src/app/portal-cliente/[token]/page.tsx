import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, Mono, StatCard } from '@regb/ui'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tu portal · REGB ERP' }

interface Invite {
  id: string
  tenant_id: string
  customer_id: string
  status: string
  customer_name: string
  tenant_name: string
}

interface Invoice {
  id: string
  number: string
  issue_date: string
  due_date: string
  total: string
  status: string
}

const badgeFactura = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'paid') return 'success'
  if (s === 'overdue' || s === 'void') return 'danger'
  if (s === 'partially_paid') return 'warning'
  return 'neutral'
}

const ETIQUETA_FACTURA: Record<string, string> = {
  open: 'Abierta',
  partially_paid: 'Pago parcial',
  paid: 'Pagada',
  overdue: 'Vencida',
  void: 'Anulada',
}

/**
 * Pagina publica del portal de clientes: sin sesion de empleado, entra por
 * token. Toda consulta se filtra por el tenant_id/customer_id que ESTE
 * lookup devuelve -nunca por un parametro que mande el cliente-.
 */
export default async function PortalClientePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const sql = db()

  const [invite] = await sql<Invite[]>`
    select pi.id, pi.tenant_id, pi.customer_id, pi.status,
           c.name as customer_name, t.legal_name as tenant_name
    from public.portal_invites pi
    join public.customers c on c.id = pi.customer_id
    join regb.tenants t on t.id = pi.tenant_id
    where pi.token = ${token}`

  if (!invite || invite.status !== 'active') notFound()

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? null

  await sql`insert into public.portal_access_log (tenant_id, invite_id, ip_address) values (${invite.tenant_id}, ${invite.id}, ${ip})`
  await sql`update public.portal_invites set last_accessed_at = now() where id = ${invite.id}`

  const facturas = await sql<Invoice[]>`
    select id, number, issue_date::text, due_date::text, total::text, status
    from public.customer_invoices
    where tenant_id = ${invite.tenant_id} and customer_id = ${invite.customer_id}
    order by issue_date desc`

  const pendiente = facturas
    .filter((f) => f.status === 'open' || f.status === 'partially_paid' || f.status === 'overdue')
    .reduce((acc, f) => acc + Number(f.total), 0)

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          {invite.tenant_name}
        </p>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
          Hola, {invite.customer_name}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">Aquí puedes ver tus facturas.</p>
      </header>

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3">
        <StatCard label="Facturas" value={String(facturas.length)} />
        <StatCard
          label="Pendiente"
          value={pendiente.toLocaleString('es-DO', { style: 'currency', currency: 'DOP' })}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Tus facturas</CardTitle>
        </CardHeader>
        <CardBody>
          {facturas.length === 0 ? (
            <EmptyState
              icon="receipt_long"
              title="Todavia no tienes facturas"
              description="Cuando te facturen, apareceran aqui."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {facturas.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      <Mono>{f.number}</Mono>
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Vence {new Date(f.due_date).toLocaleDateString('es-DO')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums text-[var(--color-text-primary)]">
                      {Number(f.total).toLocaleString('es-DO', {
                        style: 'currency',
                        currency: 'DOP',
                      })}
                    </span>
                    <Badge tone={badgeFactura(f.status)}>
                      {ETIQUETA_FACTURA[f.status] ?? f.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </main>
  )
}
