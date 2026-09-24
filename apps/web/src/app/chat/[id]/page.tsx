import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader, CardTitle, Icon, PageHeader } from '@regb/ui'
import { formatearMencion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { enviarMensajeForm } from '../actions'
import { AMBITO_CANAL } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface CanalHead {
  id: string
  name: string
  scope_type: string
  scope_label: string | null
}

interface Mensaje {
  id: string
  parent_message_id: string | null
  author_name: string
  body: string
  mentioned_names: string[]
  created_at: string
}

interface UsuarioOption {
  user_id: string
  display_name: string
}

const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'

/** Canal de chat (modulo 92): sus mensajes tal cual se enviaron, con hilos reales. */
export default async function CanalChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'chat')

  const { head, mensajes, usuarios } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<CanalHead[]>`
      select id, name, scope_type, scope_label from public.chat_channels
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, mensajes: [], usuarios: [] }

    const m = await tx<Mensaje[]>`
      select cm.id, cm.parent_message_id, coalesce(up.display_name, 'Usuario') as author_name, cm.body,
             coalesce(
               (select array_agg(mup.display_name) from public.user_profiles mup
                where mup.tenant_id = ${ctx.tenantId} and mup.user_id = any(cm.mentioned_user_ids)),
               '{}'
             ) as mentioned_names,
             cm.created_at::text
      from public.chat_messages cm
      left join public.user_profiles up on up.tenant_id = ${ctx.tenantId} and up.user_id = cm.author_id
      where cm.tenant_id = ${ctx.tenantId} and cm.channel_id = ${id}
      order by cm.created_at`

    const u = await tx<UsuarioOption[]>`
      select user_id, display_name from public.user_profiles where tenant_id = ${ctx.tenantId} order by display_name`

    return { head: h, mensajes: m, usuarios: u }
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'chat', 'chat.manage').ok
  const qs = ctx.demoQs
  const principales = mensajes.filter((m) => !m.parent_message_id)
  const respuestasDe = (padreId: string) => mensajes.filter((m) => m.parent_message_id === padreId)

  const campos = (parentId: string) => (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="channelId" value={head.id} />
      {parentId && <input type="hidden" name="parentMessageId" value={parentId} />}
    </>
  )

  const burbuja = (m: Mensaje) => (
    <li key={m.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-2.5">
      <p className="text-xs font-medium text-[var(--color-text-primary)]">
        {m.author_name}
        <span className="ml-2 font-normal text-[var(--color-text-muted)]">
          {new Date(m.created_at).toLocaleString('es-DO')}
        </span>
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{m.body}</p>
      {m.mentioned_names.length > 0 && (
        <p className="mt-1 text-xs text-[var(--color-text-link)]">
          {m.mentioned_names.map((n) => formatearMencion(n)).join(' ')}
        </p>
      )}
    </li>
  )

  return (
    <Shell {...shell} activePath="/chat">
      <div className="space-y-5">
        <PageHeader
          icon="chat"
          title={head.name}
          crumbs={[{ label: 'Chat interno', href: `/chat${qs}` }, { label: head.name }]}
          description={`${AMBITO_CANAL[head.scope_type] ?? head.scope_type}${head.scope_label ? ` · ${head.scope_label}` : ''}`}
        />

        <Card>
          <CardHeader>
            <CardTitle>Mensajes</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-3">
              {principales.length === 0 && (
                <li className="text-xs text-[var(--color-text-muted)]">Todavía no hay mensajes.</li>
              )}
              {principales.map((m) => (
                <li key={m.id} className="space-y-2">
                  {burbuja(m)}
                  {respuestasDe(m.id).length > 0 && (
                    <ul className="ml-4 space-y-2 border-l border-[var(--color-border)] pl-3">
                      {respuestasDe(m.id).map((r) => burbuja(r))}
                    </ul>
                  )}
                  {puedeGestionar && (
                    <details className="ml-4">
                      <summary className="cursor-pointer text-xs text-[var(--color-text-link)] underline-offset-2 hover:underline">
                        Responder
                      </summary>
                      <form action={enviarMensajeForm} className="mt-2 flex items-end gap-2">
                        {campos(m.id)}
                        <input
                          name="body"
                          required
                          className="h-9 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                        />
                        <BotonEnvio className={botonClase}>
                          <Icon name="send" size={14} />
                        </BotonEnvio>
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ul>

            {puedeGestionar && (
              <form
                action={enviarMensajeForm}
                className="mt-5 flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] pt-4"
              >
                {campos('')}
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Mensaje
                  <input
                    name="body"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <fieldset className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Mencionar
                  <div className="flex max-w-md flex-wrap gap-2">
                    {usuarios.map((u) => (
                      <label key={u.user_id} className="flex items-center gap-1">
                        <input type="checkbox" name="mentions" value={u.user_id} />
                        {u.display_name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <BotonEnvio className={botonClase}>
                  <Icon name="send" size={14} />
                  Enviar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
