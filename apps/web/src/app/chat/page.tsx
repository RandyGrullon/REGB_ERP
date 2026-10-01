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
import { crearCanalForm } from './actions'
import { AMBITO_CANAL } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Chat interno · REGB ERP' }

interface CanalFila {
  id: string
  name: string
  scope_type: string
  scope_label: string | null
  mensajes: string
  ultimo_en: string | null
  ultimo_texto: string | null
}

/** Chat interno (modulo 92): un mensaje enviado es un hecho historico -nunca se edita ni se borra-. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<DemoParams> }) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'chat')

  const canales = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<CanalFila[]>`
    select cc.id, cc.name, cc.scope_type, cc.scope_label,
           (select count(*)::text from public.chat_messages where channel_id = cc.id) as mensajes,
           (select m.created_at::text from public.chat_messages m
             where m.channel_id = cc.id order by m.created_at desc limit 1) as ultimo_en,
           (select m.body from public.chat_messages m
             where m.channel_id = cc.id order by m.created_at desc limit 1) as ultimo_texto
    from public.chat_channels cc
    where cc.tenant_id = ${ctx.tenantId}
    order by cc.created_at`,
  )

  const puedeGestionar = exigir(ctx, 'chat', 'chat.manage').ok
  const qs = ctx.demoQs
  const totalMensajes = canales.reduce((a, c) => a + Number(c.mensajes), 0)
  const ultimo = canales
    .map((c) => c.ultimo_en)
    .filter((f): f is string => f !== null)
    .sort()
    .at(-1)
  const cuando = (iso: string) =>
    new Date(iso).toLocaleString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Santo_Domingo',
    })

  return (
    <Shell {...shell} activePath="/chat">
      <div className="space-y-5">
        <PageHeader
          icon="chat"
          title="Chat interno"
          description="Conversaciones del equipo por sucursal, por módulo o por proyecto. Un mensaje enviado no se edita ni se borra: queda como constancia."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Canales" value={String(canales.length)} />
          <StatCard label="Mensajes" value={totalMensajes.toLocaleString('es-DO')} />
          <StatCard
            label="Último mensaje"
            value={ultimo ? cuando(ultimo) : '—'}
            hint={ultimo ? undefined : 'todavía nadie ha escrito'}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Canales</CardTitle>
          </CardHeader>
          <CardBody>
            {canales.length === 0 ? (
              <EmptyState
                icon="chat"
                title="Todavía no hay ningún canal"
                description="Crea el primero abajo."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Canal</TH>
                    <TH>Ámbito</TH>
                    <TH>Último mensaje</TH>
                    <TH numeric>Mensajes</TH>
                  </TR>
                </THead>
                <TBody>
                  {canales.map((c) => (
                    <TR key={c.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <a
                          href={`/chat/${c.id}${qs}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {c.name}
                        </a>
                      </TD>
                      <TD className="text-[var(--color-text-muted)]">
                        <Badge tone="neutral">{AMBITO_CANAL[c.scope_type] ?? c.scope_type}</Badge>
                        {c.scope_label && <span className="ml-2">{c.scope_label}</span>}
                      </TD>
                      <TD className="max-w-72">
                        {c.ultimo_en ? (
                          <>
                            <span className="block truncate text-[var(--color-text-secondary)]">
                              {c.ultimo_texto}
                            </span>
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {cuando(c.ultimo_en)}
                            </span>
                          </>
                        ) : (
                          <span className="text-[var(--color-text-muted)]">Sin mensajes</span>
                        )}
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
                  Ámbito
                  <select
                    name="scopeType"
                    defaultValue="general"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="general">General</option>
                    <option value="module">Módulo</option>
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
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
