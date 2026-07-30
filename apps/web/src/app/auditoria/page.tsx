import { Badge, EmptyState, Table, THead, TBody, TR, TH, TD, Mono } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Auditoria · REGB ERP' }

interface AuditRow {
  id: string
  module_id: string | null
  entity: string
  action: string
  actor: string | null
  at: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

const ACTION_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
  impersonate: 'warning',
  login: 'neutral',
  export: 'neutral',
}

const ACTION_LABEL: Record<string, string> = {
  create: 'Creo',
  update: 'Cambio',
  delete: 'Borro',
  impersonate: 'Impersonacion',
  login: 'Entro',
  export: 'Exporto',
}

/** Que cambio entre before y after, resumido a las claves que difieren. */
function resumen(row: AuditRow): string {
  if (row.action === 'create' && row.after) {
    const nombre = row.after['display_name'] ?? row.after['name'] ?? row.after['legal_name'] ?? ''
    return nombre ? String(nombre) : '—'
  }
  if (row.action === 'update' && row.before && row.after) {
    const cambiadas = Object.keys(row.after).filter(
      (k) =>
        !['updated_at', 'created_at'].includes(k) &&
        JSON.stringify(row.before?.[k]) !== JSON.stringify(row.after?.[k]),
    )
    return cambiadas.slice(0, 4).join(', ') || '—'
  }
  if (row.action === 'impersonate' && row.after) {
    return String(row.after['reason'] ?? '')
  }
  return '—'
}

/**
 * Auditoria (S11): la bitacora inmutable, visible. Solo lectura por
 * diseno — no hay accion que la toque, ni siquiera para el Owner.
 */
export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams & { entidad?: string }>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'audit')

  const entidad = params.entidad ?? ''
  const rows = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<AuditRow[]>`
      select l.id::text, l.module_id, l.entity, l.action,
             p.display_name as actor, l.at::text, l.before, l.after
      from audit.log l
      left join public.user_profiles p
        on p.tenant_id = l.tenant_id and p.user_id = l.user_id
      where l.tenant_id = ${ctx.tenantId}
        and (${entidad} = '' or l.entity = ${entidad})
      order by l.at desc
      limit 200`,
  )

  const entidades = [...new Set(rows.map((r) => r.entity))].sort()
  const fecha = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/auditoria">
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Auditoria</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Quien hizo que y cuando. Esta bitacora no se puede editar ni borrar — por nadie.
          </p>
        </div>

        {entidades.length > 1 && (
          <nav aria-label="Filtrar por entidad" className="flex flex-wrap gap-2">
            <a
              href={`/auditoria${ctx.demoQs}`}
              className={`rounded-[var(--radius-full)] px-3 py-1 text-xs ${!entidad ? 'bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]' : 'bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]'}`}
            >
              Todo
            </a>
            {entidades.map((e) => (
              <a
                key={e}
                href={`/auditoria${ctx.demoQs ? ctx.demoQs + '&' : '?'}entidad=${e}`}
                className={`rounded-[var(--radius-full)] px-3 py-1 text-xs ${entidad === e ? 'bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]' : 'bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]'}`}
              >
                {e}
              </a>
            ))}
          </nav>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon="📜"
            title="Sin actividad registrada"
            description="Cada creacion, cambio o borrado quedara aqui con su antes y su despues."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuando</TH>
                <TH>Quien</TH>
                <TH>Accion</TH>
                <TH>Entidad</TH>
                <TH>Detalle</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <span className="whitespace-nowrap">{fecha(r.at)}</span>
                  </TD>
                  <TD>{r.actor ?? 'Sistema'}</TD>
                  <TD>
                    <Badge tone={ACTION_TONE[r.action] ?? 'neutral'}>
                      {ACTION_LABEL[r.action] ?? r.action}
                    </Badge>
                  </TD>
                  <TD>
                    <Mono>{r.entity}</Mono>
                  </TD>
                  <TD className="max-w-64 truncate">{resumen(r)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
