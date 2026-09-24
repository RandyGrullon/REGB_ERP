import { Badge, EmptyState, Table, THead, TBody, TR, TH, TD, Mono } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { nombreCampo, nombreEntidad, valor } from './etiquetas'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Auditoría · REGB ERP' }

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
  create: 'Creó',
  update: 'Cambió',
  delete: 'Borró',
  impersonate: 'Suplantación',
  login: 'Entró',
  export: 'Exportó',
}

/** Las claves que difieren entre before y after (sin las marcas de tiempo). */
function cambiadas(row: AuditRow): string[] {
  if (!row.before || !row.after) return []
  return Object.keys(row.after).filter(
    (k) =>
      !['updated_at', 'created_at'].includes(k) &&
      JSON.stringify(row.before?.[k]) !== JSON.stringify(row.after?.[k]),
  )
}

/** De quien o de que habla la fila, en una linea. */
function resumen(row: AuditRow): string {
  const fuente = row.after ?? row.before
  const nombre =
    fuente?.['display_name'] ?? fuente?.['name'] ?? fuente?.['legal_name'] ?? fuente?.['number']
  if (row.action === 'update') {
    const c = cambiadas(row)
    const campos = c.slice(0, 3).map(nombreCampo).join(', ') + (c.length > 3 ? '…' : '')
    return [nombre ? String(nombre) : '', campos].filter(Boolean).join(' · ') || '—'
  }
  if (row.action === 'impersonate' && row.after) {
    return String(row.after['reason'] ?? '')
  }
  return nombre ? String(nombre) : '—'
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

  // Los filtros salen de TODA la bitacora, no de las filas ya filtradas:
  // antes, al tocar uno, la barra se quedaba con una sola opcion, se
  // escondia y no habia como volver a "Todo".
  const entidades = (
    await asUser(
      ctx.userId,
      ctx.tenantId,
      (tx) => tx<{ entity: string }[]>`
        select entity from audit.log where tenant_id = ${ctx.tenantId}
        group by entity order by count(*) desc limit 30`,
    )
  ).map((e) => e.entity)
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
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Auditoría</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Quién hizo qué y cuándo. Esta bitácora no se puede editar ni borrar — por nadie. Toca un
            cambio para ver el antes y el después.
          </p>
        </div>

        {entidades.length > 1 && (
          <nav aria-label="Filtrar por tipo de registro" className="flex flex-wrap gap-2">
            <a
              href={`/auditoria${ctx.demoQs}`}
              aria-current={!entidad ? 'page' : undefined}
              className={`rounded-[var(--radius-full)] px-3 py-1 text-xs ${!entidad ? 'bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]' : 'bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]'}`}
            >
              Todo
            </a>
            {entidades.map((e) => (
              <a
                key={e}
                href={`/auditoria${ctx.demoQs ? ctx.demoQs + '&' : '?'}entidad=${e}`}
                aria-current={entidad === e ? 'page' : undefined}
                className={`rounded-[var(--radius-full)] px-3 py-1 text-xs ${entidad === e ? 'bg-[var(--color-brand-soft)] text-[var(--color-text-primary)]' : 'bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]'}`}
              >
                {nombreEntidad(e)}
              </a>
            ))}
          </nav>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon="history"
            title="Sin actividad registrada"
            description="Cada creación, cambio o borrado quedará aquí con su antes y su después."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cuándo</TH>
                <TH>Quién</TH>
                <TH>Acción</TH>
                <TH>Qué</TH>
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
                    <span title={r.entity}>{nombreEntidad(r.entity)}</span>
                  </TD>
                  <TD className="max-w-80">
                    {r.action === 'update' && cambiadas(r).length > 0 ? (
                      <details>
                        <summary className="cursor-pointer truncate">{resumen(r)}</summary>
                        <ul className="mt-1.5 space-y-1 text-xs text-[var(--color-text-secondary)]">
                          {cambiadas(r).map((k) => (
                            <li key={k}>
                              <span className="font-semibold text-[var(--color-text-primary)]">
                                {nombreCampo(k)}
                              </span>
                              : <Mono>{valor(r.before?.[k])}</Mono> →{' '}
                              <Mono>{valor(r.after?.[k])}</Mono>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <span className="block truncate">{resumen(r)}</span>
                    )}
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
