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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearInvitacionForm, revocarInvitacionForm } from './actions'
import { ESTADO_INVITACION } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Portal de clientes · REGB ERP' }

interface InvitacionRow {
  id: string
  customer_name: string
  email: string
  token: string
  status: string
  last_accessed_at: string | null
}

interface ClienteOption {
  id: string
  name: string
}

const badgeEstado = (s: string): 'success' | 'danger' | 'warning' => {
  if (s === 'active') return 'success'
  if (s === 'revoked') return 'danger'
  return 'warning'
}

/** Portal de clientes (modulo 39): acceso por invitacion con token, sin contraseñas. */
export default async function PortalClientesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'customer-portal')

  const { invitaciones, clientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const i = await tx<InvitacionRow[]>`
      select pi.id, c.name as customer_name, pi.email, pi.token, pi.status, pi.last_accessed_at::text
      from public.portal_invites pi
      join public.customers c on c.id = pi.customer_id
      where pi.tenant_id = ${ctx.tenantId}
      order by pi.created_at desc`
    const cl = await tx<ClienteOption[]>`
      select id, name from public.customers where tenant_id = ${ctx.tenantId} order by name limit 300`
    return { invitaciones: i, clientes: cl }
  })

  const activas = invitaciones.filter((i) => i.status === 'active').length
  const puedeGestionar = exigir(ctx, 'customer-portal', 'customer-portal.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/portal-clientes">
      <div className="space-y-5">
        <PageHeader
          icon="open_in_new"
          title="Portal de clientes"
          description="El cliente entra con un enlace unico, no con una contraseña que administrar. Revocar lo desactiva de inmediato."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Invitaciones" value={String(invitaciones.length)} />
          <StatCard label="Activas" value={String(activas)} />
        </section>

        {invitaciones.length === 0 ? (
          <EmptyState icon="open_in_new" title="Todavia no hay ninguna invitacion" description="Crea la primera abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>Correo</TH>
                <TH>Ultima visita</TH>
                <TH>Estado</TH>
                <TH>
                  <span className="sr-only">Accion</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {invitaciones.map((i) => (
                <TR key={i.id}>
                  <TD className="text-[var(--color-text-primary)]">{i.customer_name}</TD>
                  <TD className="text-[var(--color-text-muted)]">{i.email}</TD>
                  <TD className="text-[var(--color-text-muted)]">
                    {i.last_accessed_at ? new Date(i.last_accessed_at).toLocaleString('es-DO') : 'Nunca'}
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(i.status)}>{ESTADO_INVITACION[i.status] ?? i.status}</Badge>
                  </TD>
                  <TD>
                    {i.status === 'active' && puedeGestionar && (
                      <details className="inline-block">
                        <summary className="cursor-pointer list-none text-xs text-[var(--color-text-link)] underline-offset-2 hover:underline">
                          Ver enlace
                        </summary>
                        <p className="mt-1 max-w-xs break-all text-xs text-[var(--color-text-muted)]">
                          <Mono>/portal-cliente/{i.token}</Mono>
                        </p>
                        <form action={revocarInvitacionForm} className="mt-1">
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="inviteId" value={i.id} />
                          <button
                            type="submit"
                            className="flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]"
                          >
                            <Icon name="block" size={12} />
                            Revocar
                          </button>
                        </form>
                      </details>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Invitar a un cliente</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearInvitacionForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente
                  <select
                    name="customerId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Correo
                  <input
                    name="email"
                    type="email"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="add" size={14} />
                  Invitar
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
