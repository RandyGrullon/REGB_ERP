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
import type { EstadoLead } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { registrarActividadForm, transicionarLeadForm } from '../actions'
import { ESTADO_LEAD, FUENTE_LEAD, TIPO_ACTIVIDAD } from '../estados'

export const dynamic = 'force-dynamic'

interface LeadHead {
  id: string
  name: string
  company: string | null
  email: string | null
  phone: string | null
  source: string
  score: string
  status: EstadoLead
  assignee_name: string | null
}

interface ActividadRow {
  id: string
  type: string
  notes: string
  occurred_at: string
}

const fecha = (iso: string) => new Date(iso).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'

/** Detalle de un lead (modulo 29): su maquina de estados y su linea de tiempo. */
export default async function LeadDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'crm')

  const { head, actividades } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<LeadHead[]>`
      select l.id, l.name, l.company, l.email, l.phone, l.source, l.score::text, l.status,
             up.display_name as assignee_name
      from public.leads l
      left join public.user_profiles up on up.user_id = l.assigned_to and up.tenant_id = l.tenant_id
      where l.id = ${id} and l.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, actividades: [] }

    const a = await tx<ActividadRow[]>`
      select id, type, notes, occurred_at::text from public.lead_activities
      where lead_id = ${id} and tenant_id = ${ctx.tenantId}
      order by occurred_at desc`

    return { head: h, actividades: a }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'crm', 'crm.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="leadId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/crm">
      <div className="space-y-5">
        <PageHeader
          icon="contacts"
          title={head.name}
          crumbs={[{ label: 'CRM / Leads', href: `/crm${qs}` }, { label: head.name }]}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{ESTADO_LEAD[head.status] ?? head.status}</Badge>
              <Badge tone="success">{head.score}</Badge>
            </div>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Empresa" value={head.company ?? '—'} />
          <StatCard label="Fuente" value={FUENTE_LEAD[head.source] ?? head.source} />
          <StatCard label="Asignado a" value={head.assignee_name ?? 'Sin asignar'} />
        </section>

        <p className="text-xs text-[var(--color-text-muted)]">
          {head.email ?? 'Sin correo'} · {head.phone ?? 'Sin telefono'}
        </p>

        {puedeGestionar && head.status !== 'converted' && head.status !== 'disqualified' && (
          <div className="flex flex-wrap gap-2">
            {head.status === 'new' && (
              <form action={transicionarLeadForm}>
                {campos}
                <input type="hidden" name="siguiente" value="contacted" />
                <button type="submit" className={botonClase}>
                  <Icon name="call" size={14} />
                  Marcar contactado
                </button>
              </form>
            )}
            {head.status === 'contacted' && (
              <form action={transicionarLeadForm}>
                {campos}
                <input type="hidden" name="siguiente" value="qualified" />
                <button type="submit" className={botonClase}>
                  <Icon name="verified" size={14} />
                  Calificar
                </button>
              </form>
            )}
            {head.status === 'qualified' && (
              <form action={transicionarLeadForm}>
                {campos}
                <input type="hidden" name="siguiente" value="converted" />
                <button type="submit" className={botonClase}>
                  <Icon name="check_circle" size={14} />
                  Convertir
                </button>
              </form>
            )}
            <form action={transicionarLeadForm}>
              {campos}
              <input type="hidden" name="siguiente" value="disqualified" />
              <button type="submit" className={botonSecundarioClase}>
                Descalificar
              </button>
            </form>
          </div>
        )}

        <Table>
          <THead>
            <TR>
              <TH>Tipo</TH>
              <TH>Notas</TH>
              <TH>Fecha</TH>
            </TR>
          </THead>
          <TBody>
            {actividades.length === 0 ? (
              <TR>
                <TD colSpan={3} className="text-center text-[var(--color-text-muted)]">
                  Todavia no hay ninguna actividad registrada.
                </TD>
              </TR>
            ) : (
              actividades.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Badge tone="neutral">{TIPO_ACTIVIDAD[a.type] ?? a.type}</Badge>
                  </TD>
                  <TD className="text-[var(--color-text-primary)]">{a.notes}</TD>
                  <TD className="text-[var(--color-text-muted)]">{fecha(a.occurred_at)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar actividad</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarActividadForm} className="flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipo
                  <select
                    name="type"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="call">Llamada</option>
                    <option value="email">Correo</option>
                    <option value="meeting">Reunion</option>
                    <option value="note">Nota</option>
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Notas
                  <input
                    name="notes"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <button type="submit" className={botonClase}>
                  <Icon name="add" size={14} />
                  Registrar
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
