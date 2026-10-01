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
import { ACCIONES_AUTOMATIZACION } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { nombreEvento } from '@/lib/eventos'
import { eventosDisponibles } from '@/lib/eventos-disponibles'
import { alternarReglaForm, crearReglaForm, procesarEventosPendientesForm } from './actions'
import { ACCION_LABEL, ESTADO_REGLA, OPERADOR_CONDICION } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Automatizaciones · REGB ERP' }

interface ReglaFila {
  id: string
  name: string
  trigger_event_type: string
  condition_field: string | null
  condition_operator: string | null
  condition_value: string | null
  action_type: string
  status: string
}

interface EjecucionFila {
  id: string
  rule_name: string
  event_type: string
  matched: boolean
  executed_at: string
}

/** Automatizaciones (modulo 88): solo LEE el rastro de eventos, nunca toca el despachador real. */
export default async function AutomatizacionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'automations')

  const { reglas, ejecuciones, notificacionesCreadas } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const r = await tx<ReglaFila[]>`
      select id, name, trigger_event_type, condition_field, condition_operator, condition_value, action_type, status
      from public.automation_rules where tenant_id = ${ctx.tenantId} order by created_at desc`
      const e = await tx<EjecucionFila[]>`
      select ar.id, r.name as rule_name, eo.type as event_type, ar.matched, ar.executed_at::text
      from public.automation_runs ar
      join public.automation_rules r on r.id = ar.rule_id
      join public.event_outbox eo on eo.id = ar.event_id
      where ar.tenant_id = ${ctx.tenantId}
      order by ar.executed_at desc
      limit 20`
      const [n] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.notifications where tenant_id = ${ctx.tenantId} and module_id = 'automations'`
      return { reglas: r, ejecuciones: e, notificacionesCreadas: Number(n?.n ?? 0) }
    },
  )

  const activas = reglas.filter((r) => r.status === 'active').length
  const puedeGestionar = exigir(ctx, 'automations', 'automations.manage').ok
  const qs = ctx.demoQs
  const eventos = eventosDisponibles(shell.data.activeModules)

  return (
    <Shell {...shell} activePath="/automatizaciones">
      <div className="space-y-5">
        <PageHeader
          icon="bolt"
          title="Automatizaciones"
          description="Reglas de «cuando pase esto, haz aquello»: cuando se resuelve un ticket o se confirma un pedido, REGB le deja un aviso a tu equipo sin que nadie tenga que acordarse."
          actions={
            puedeGestionar && (
              <form action={procesarEventosPendientesForm}>
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="play_arrow" size={14} />
                  Procesar eventos pendientes
                </BotonEnvio>
              </form>
            )
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Reglas activas" value={String(activas)} />
          <StatCard label="Ejecuciones registradas" value={String(ejecuciones.length)} />
          <StatCard label="Notificaciones creadas" value={String(notificacionesCreadas)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Reglas</CardTitle>
          </CardHeader>
          <CardBody>
            {reglas.length === 0 ? (
              <EmptyState
                icon="bolt"
                title="Todavía no hay ninguna regla"
                description="Crea la primera abajo: elige cuándo se dispara, si hace falta una condición, y el aviso que le llega al equipo."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Regla</TH>
                    <TH>Cuando</TH>
                    <TH>Condición</TH>
                    <TH>Acción</TH>
                    <TH>Estado</TH>
                    <TH>
                      <span className="sr-only">Acción</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {reglas.map((r) => (
                    <TR key={r.id}>
                      <TD className="text-[var(--color-text-primary)]">{r.name}</TD>
                      <TD className="text-[var(--color-text-muted)]">
                        <span title={r.trigger_event_type}>
                          {nombreEvento(r.trigger_event_type)}
                        </span>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {r.condition_field
                          ? `${r.condition_field} ${OPERADOR_CONDICION[r.condition_operator ?? ''] ?? r.condition_operator} ${r.condition_value}`
                          : 'Siempre'}
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {ACCION_LABEL[r.action_type] ?? r.action_type}
                      </TD>
                      <TD>
                        <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>
                          {ESTADO_REGLA[r.status] ?? r.status}
                        </Badge>
                      </TD>
                      <TD>
                        {puedeGestionar && (
                          <form action={alternarReglaForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="ruleId" value={r.id} />
                            <input
                              type="hidden"
                              name="siguiente"
                              value={r.status === 'active' ? 'paused' : 'active'}
                            />
                            <BotonEnvio className="flex h-7 items-center rounded-full border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]">
                              {r.status === 'active' ? 'Pausar' : 'Reanudar'}
                            </BotonEnvio>
                          </form>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && (
              <form action={crearReglaForm} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="name"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cuando
                  <select
                    name="triggerEventType"
                    required
                    defaultValue=""
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="" disabled>
                      Elige qué tiene que pasar…
                    </option>
                    {eventos.map((g) => (
                      <optgroup key={g.modulo} label={g.modulo}>
                        {g.eventos.map((ev) => (
                          <option key={ev.tipo} value={ev.tipo}>
                            {ev.nombre}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Si el dato (opcional)
                  <input
                    name="conditionField"
                    placeholder="priority"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Operador
                  <select
                    name="conditionOperator"
                    defaultValue=""
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">—</option>
                    <option value="eq">es igual a</option>
                    <option value="neq">es distinto de</option>
                    <option value="gt">es mayor que</option>
                    <option value="lt">es menor que</option>
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Valor
                  <input
                    name="conditionValue"
                    placeholder="urgent"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Acción
                  <select
                    name="actionType"
                    defaultValue={ACCIONES_AUTOMATIZACION[0]}
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {ACCIONES_AUTOMATIZACION.map((a) => (
                      <option key={a} value={a}>
                        {ACCION_LABEL[a] ?? a}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Título de la notificación
                  <input
                    name="title"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cuerpo (opcional)
                  <input
                    name="body"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ejecuciones recientes</CardTitle>
          </CardHeader>
          <CardBody>
            {ejecuciones.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Todavía no se ha procesado ningún evento.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {ejecuciones.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)]">{e.rule_name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        <span title={e.event_type}>{nombreEvento(e.event_type)}</span> ·{' '}
                        {new Date(e.executed_at).toLocaleString('es-DO', {
                          day: 'numeric',
                          month: 'short',
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: 'America/Santo_Domingo',
                        })}
                      </p>
                    </div>
                    <Badge tone={e.matched ? 'success' : 'neutral'}>
                      {e.matched ? 'Ejecutada' : 'No cumplió la condición'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lo que esto no hace</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              Todavía no corre sola en segundo plano: las reglas se aplican cuando alguien toca
              «Procesar eventos pendientes». Y por ahora lo único que hace es dejar un aviso en
              Notificaciones; no manda correos ni cambia datos por su cuenta.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
