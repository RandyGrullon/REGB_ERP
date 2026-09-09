import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, Icon, PageHeader, StatCard, TBody, TD, TH, THead, TR, Table } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearCanalForm } from './actions'
import { AMBITO_CANAL } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Chat interno · REGB ERP' }

interface CanalFila {
  id: string
  name: string
  scope_type: string
  scope_label: string | null
  mensajes: string
}

/** Chat interno (modulo 92): un mensaje enviado es un hecho historico -nunca se edita ni se borra-. */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'chat')

  const canales = await asUser(ctx.userId, ctx.tenantId, (tx) => tx<CanalFila[]>`
    select cc.id, cc.name, cc.scope_type, cc.scope_label,
           (select count(*)::text from public.chat_messages where channel_id = cc.id) as mensajes
    from public.chat_channels cc
    where cc.tenant_id = ${ctx.tenantId}
    order by cc.created_at`)

  const puedeGestionar = exigir(ctx, 'chat', 'chat.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/chat">
      <div className="space-y-5">
        <PageHeader
          icon="chat"
          title="Chat interno"
          description="Un mensaje enviado es un hecho historico -nunca se edita ni se borra despues-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Canales" value={String(canales.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Canales</CardTitle>
          </CardHeader>
          <CardBody>
            {canales.length === 0 ? (
              <EmptyState icon="chat" title="Todavia no hay ningun canal" description="Crea el primero abajo." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Canal</TH>
                    <TH>Ambito</TH>
                    <TH numeric>Mensajes</TH>
                  </TR>
                </THead>
                <TBody>
                  {canales.map((c) => (
                    <TR key={c.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <a href={`/chat/${c.id}${qs}`} className="underline-offset-2 hover:underline">
                          {c.name}
                        </a>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        <Badge tone="neutral">{AMBITO_CANAL[c.scope_type] ?? c.scope_type}</Badge>
                        {c.scope_label && <span className="ml-2">{c.scope_label}</span>}
                      </TD>
                      <TD numeric>
                        <span className="tabular">{c.mensajes}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {puedeGestionar && (
              <form action={crearCanalForm} className="mt-4 flex flex-wrap items-end gap-3">
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
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Ambito
                  <select
                    name="scopeType"
                    defaultValue="general"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="general">General</option>
                    <option value="module">Modulo</option>
                    <option value="project">Proyecto</option>
                    <option value="branch">Sucursal</option>
                  </select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Etiqueta (opcional)
                  <input
                    name="scopeLabel"
                    placeholder="ej. Sucursal Bella Vista"
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
      </div>
    </Shell>
  )
}
