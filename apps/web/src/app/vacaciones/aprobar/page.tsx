import {
  EmptyState,
  Icon,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { resolverSolicitudForm } from '../actions'
import { TIPO_AUSENCIA } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Aprobar vacaciones · REGB ERP' }

interface SolicitudRow {
  id: string
  employee_name: string
  leave_type: string
  start_date: string
  end_date: string
  business_days: number
  reason: string | null
}

const fechaCorta = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('es-DO', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Cola de aprobacion de vacaciones (modulo 64): solo lo pendiente, nada mas. */
export default async function AprobarVacacionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'time-off')

  const pendientes = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<SolicitudRow[]>`
      select r.id, e.first_name || ' ' || e.last_name as employee_name, r.leave_type,
             r.start_date::text, r.end_date::text, r.business_days, r.reason
      from public.time_off_requests r
      join public.employees e on e.id = r.employee_id
      where r.tenant_id = ${ctx.tenantId} and r.status = 'pending'
      order by r.created_at`,
  )

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/vacaciones">
      <div className="space-y-5">
        <PageHeader
          icon="fact_check"
          title="Aprobar solicitudes"
          description="Solo lo pendiente. Una vez aprobada o rechazada, la solicitud queda fija."
          crumbs={[{ label: 'Vacaciones', href: `/vacaciones${qs}` }, { label: 'Aprobar' }]}
        />

        {pendientes.length === 0 ? (
          <EmptyState
            icon="fact_check"
            title="No hay ninguna solicitud pendiente"
            description="Todo lo que se ha pedido ya fue resuelto."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Empleado</TH>
                <TH>Tipo</TH>
                <TH>Desde</TH>
                <TH>Hasta</TH>
                <TH numeric>Dias</TH>
                <TH>Motivo</TH>
                <TH>
                  <span className="sr-only">Accion</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {pendientes.map((s) => (
                <TR key={s.id}>
                  <TD className="text-[var(--color-text-primary)]">{s.employee_name}</TD>
                  <TD>{TIPO_AUSENCIA[s.leave_type] ?? s.leave_type}</TD>
                  <TD>{fechaCorta(s.start_date)}</TD>
                  <TD>{fechaCorta(s.end_date)}</TD>
                  <TD numeric>
                    <span className="tabular">{s.business_days}</span>
                  </TD>
                  <TD className="max-w-56 truncate">{s.reason ?? '—'}</TD>
                  <TD>
                    <div className="flex gap-1.5">
                      <form action={resolverSolicitudForm}>
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="recordId" value={s.id} />
                        <input type="hidden" name="decision" value="approved" />
                        <BotonEnvio
                          
                          className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-semantic-success)] px-2 text-xs font-medium text-white hover:opacity-90">
                          <Icon name="check" size={14} />
                          Aprobar
                        </BotonEnvio>
                      </form>
                      <form action={resolverSolicitudForm}>
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="recordId" value={s.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <BotonEnvio
                          
                          className="flex h-8 items-center gap-1 rounded-full border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                          <Icon name="close" size={14} />
                          Rechazar
                        </BotonEnvio>
                      </form>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
