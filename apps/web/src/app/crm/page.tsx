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
import { asignarLeadsPendientesForm, crearLeadForm } from './actions'
import { ESTADO_LEAD, FUENTE_LEAD } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'CRM / Leads · REGB ERP' }

interface LeadRow {
  id: string
  name: string
  company: string | null
  source: string
  score: string
  status: string
  assignee_name: string | null
}

const badgeEstado = (s: string): 'success' | 'warning' | 'neutral' | 'danger' => {
  if (s === 'converted') return 'success'
  if (s === 'disqualified') return 'danger'
  if (s === 'new') return 'warning'
  return 'neutral'
}

const badgePuntaje = (n: number): 'success' | 'warning' | 'neutral' => {
  if (n >= 70) return 'success'
  if (n >= 40) return 'warning'
  return 'neutral'
}

/** CRM / Leads (modulo 29): puntaje explicable y asignacion automatica en round-robin. */
export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'crm')

  const leads = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<LeadRow[]>`
      select l.id, l.name, l.company, l.source, l.score::text, l.status, up.display_name as assignee_name
      from public.leads l
      left join public.user_profiles up on up.user_id = l.assigned_to and up.tenant_id = l.tenant_id
      where l.tenant_id = ${ctx.tenantId}
      order by l.score desc, l.created_at desc`,
  )

  const pendientes = leads.filter((l) => l.assignee_name === null && l.status !== 'disqualified').length
  const puedeGestionar = exigir(ctx, 'crm', 'crm.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/crm">
      <div className="space-y-5">
        <PageHeader
          icon="contacts"
          title="CRM / Leads"
          description="Un puntaje explicable -email, telefono, fuente-, no una caja negra de IA. Asignacion automatica en round-robin."
          actions={
            puedeGestionar &&
            pendientes > 0 && (
              <form action={asignarLeadsPendientesForm}>
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="shuffle" size={14} />
                  Asignar {pendientes} pendiente{pendientes === 1 ? '' : 's'}
                </BotonEnvio>
              </form>
            )
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Leads" value={String(leads.length)} />
          <StatCard label="Sin asignar" value={String(pendientes)} />
        </section>

        {leads.length === 0 ? (
          <EmptyState icon="contacts" title="Todavia no hay ningun lead" description="Crea el primero abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Lead</TH>
                <TH>Fuente</TH>
                <TH numeric>Puntaje</TH>
                <TH>Estado</TH>
                <TH>Asignado a</TH>
              </TR>
            </THead>
            <TBody>
              {leads.map((l) => (
                <TR key={l.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/crm/${l.id}${qs}`} className="underline-offset-2 hover:underline">
                      {l.name}
                    </a>
                    {l.company && <span className="ml-1.5 text-[var(--color-text-muted)]">· {l.company}</span>}
                  </TD>
                  <TD>{FUENTE_LEAD[l.source] ?? l.source}</TD>
                  <TD numeric>
                    <Badge tone={badgePuntaje(Number(l.score))}>{l.score}</Badge>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(l.status)}>{ESTADO_LEAD[l.status] ?? l.status}</Badge>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">{l.assignee_name ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo lead</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearLeadForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empresa (opcional)
                  <input
                    name="company"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Correo (opcional)
                  <input
                    name="email"
                    type="email"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Telefono (opcional)
                  <input
                    name="phone"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fuente
                  <select
                    name="source"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="referral">Referido</option>
                    <option value="event">Evento</option>
                    <option value="web">Sitio web</option>
                    <option value="cold">Frio</option>
                  </select>
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
