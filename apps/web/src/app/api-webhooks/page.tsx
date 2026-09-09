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
import { alternarEndpointForm, crearEndpointForm, enviarPruebaForm, revocarLlaveForm } from './actions'
import { CrearLlaveForm } from './CrearLlaveForm'
import { ESTADO_ENDPOINT, ESTADO_LLAVE, SCOPE_LABEL } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'API & Webhooks · REGB ERP' }

interface LlaveFila {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  rate_limit_per_minute: number
  status: string
  last_used_at: string | null
}

interface EndpointFila {
  id: string
  url: string
  event_types: string[]
  status: string
}

interface EntregaFila {
  id: string
  url: string
  status_code: number | null
  success: boolean
  attempted_at: string
}

/** API & Webhooks (modulo 89): la llave se ve completa una sola vez; el webhook SI hace una llamada HTTP real. */
export default async function ApiWebhooksPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'api-webhooks')

  const { llaves, endpoints, entregas } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const k = await tx<LlaveFila[]>`
      select id, name, key_prefix, scopes, rate_limit_per_minute, status, last_used_at::text
      from public.api_keys where tenant_id = ${ctx.tenantId} order by created_at desc`
    const e = await tx<EndpointFila[]>`
      select id, url, event_types, status from public.webhook_endpoints
      where tenant_id = ${ctx.tenantId} order by created_at desc`
    const d = await tx<EntregaFila[]>`
      select wd.id, we.url, wd.status_code, wd.success, wd.attempted_at::text
      from public.webhook_deliveries wd
      join public.webhook_endpoints we on we.id = wd.endpoint_id
      where wd.tenant_id = ${ctx.tenantId}
      order by wd.attempted_at desc
      limit 20`
    return { llaves: k, endpoints: e, entregas: d }
  })

  const llavesActivas = llaves.filter((k) => k.status === 'active').length
  const entregasFallidas = entregas.filter((d) => !d.success).length
  const puedeGestionar = exigir(ctx, 'api-webhooks', 'api-webhooks.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/api-webhooks">
      <div className="space-y-5">
        <PageHeader
          icon="webhook"
          title="API & Webhooks"
          description="La llave se muestra completa una sola vez. Los webhooks SI hacen una llamada HTTP real -a la URL que tu configuraste-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Llaves activas" value={String(llavesActivas)} />
          <StatCard label="Endpoints" value={String(endpoints.length)} />
          <StatCard label="Entregas fallidas (recientes)" value={String(entregasFallidas)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Llaves de API</CardTitle>
          </CardHeader>
          <CardBody>
            {llaves.length === 0 ? (
              <EmptyState icon="key" title="Todavia no hay ninguna llave" description="Crea la primera abajo." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Nombre</TH>
                    <TH>Prefijo</TH>
                    <TH>Permisos</TH>
                    <TH numeric>Limite/min</TH>
                    <TH>Estado</TH>
                    <TH>
                      <span className="sr-only">Accion</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {llaves.map((k) => (
                    <TR key={k.id}>
                      <TD className="text-[var(--color-text-primary)]">{k.name}</TD>
                      <TD className="text-[var(--color-text-muted)]">
                        <Mono>{k.key_prefix}…</Mono>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        {k.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}
                      </TD>
                      <TD numeric>
                        <span className="tabular">{k.rate_limit_per_minute}</span>
                      </TD>
                      <TD>
                        <Badge tone={k.status === 'active' ? 'success' : 'neutral'}>{ESTADO_LLAVE[k.status] ?? k.status}</Badge>
                      </TD>
                      <TD>
                        {puedeGestionar && k.status === 'active' && (
                          <form action={revocarLlaveForm}>
                            <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                            <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                            <input type="hidden" name="keyId" value={k.id} />
                            <button
                              type="submit"
                              className="flex h-7 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-semantic-text-danger)] hover:bg-[var(--color-surface-raised)]"
                            >
                              Revocar
                            </button>
                          </form>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && <div className="mt-4"><CrearLlaveForm tenant={qs ? ctx.tenantSlug : ''} rol={qs ? ctx.roleName : ''} /></div>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhooks salientes</CardTitle>
          </CardHeader>
          <CardBody>
            {endpoints.length === 0 ? (
              <EmptyState icon="webhook" title="Todavia no hay ningun endpoint" description="Crea el primero abajo." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>URL</TH>
                    <TH>Eventos</TH>
                    <TH>Estado</TH>
                    <TH>
                      <span className="sr-only">Accion</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {endpoints.map((e) => (
                    <TR key={e.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <Mono>{e.url}</Mono>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">{e.event_types.join(', ')}</TD>
                      <TD>
                        <Badge tone={e.status === 'active' ? 'success' : 'neutral'}>{ESTADO_ENDPOINT[e.status] ?? e.status}</Badge>
                      </TD>
                      <TD>
                        {puedeGestionar && (
                          <div className="flex gap-2">
                            <form action={enviarPruebaForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="endpointId" value={e.id} />
                              <button
                                type="submit"
                                className="flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
                              >
                                <Icon name="send" size={12} />
                                Probar
                              </button>
                            </form>
                            <form action={alternarEndpointForm}>
                              <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                              <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                              <input type="hidden" name="endpointId" value={e.id} />
                              <input type="hidden" name="siguiente" value={e.status === 'active' ? 'paused' : 'active'} />
                              <button
                                type="submit"
                                className="flex h-7 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
                              >
                                {e.status === 'active' ? 'Pausar' : 'Reanudar'}
                              </button>
                            </form>
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && (
              <form action={crearEndpointForm} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  URL
                  <input
                    name="url"
                    required
                    placeholder="https://tu-sistema.do/webhook"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Tipos de evento (separados por coma)
                  <input
                    name="eventTypes"
                    required
                    placeholder="crm.lead.qualified, helpdesk.ticket.resolved"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="add" size={14} />
                  Crear
                </button>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Entregas recientes</CardTitle>
          </CardHeader>
          <CardBody>
            {entregas.length === 0 ? (
              <p className="text-xs text-[var(--color-text-muted)]">Todavia no se ha entregado ningun webhook.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {entregas.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-sm text-[var(--color-text-primary)]">
                        <Mono>{d.url}</Mono>
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">{new Date(d.attempted_at).toLocaleString('es-DO')}</p>
                    </div>
                    <Badge tone={d.success ? 'success' : 'danger'}>{d.status_code ?? 'Sin respuesta'}</Badge>
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
              El limite por minuto se guarda como configuracion -esta version todavia no expone un
              endpoint REST real que lo aplique contra trafico entrante-. Los webhooks salientes SI
              hacen una llamada HTTP real a la URL configurada.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
