import { Badge, EmptyState, Icon, PageHeader } from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { marcarLeida, marcarTodasLeidas } from './actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Notificaciones · REGB ERP' }

interface NoticeRow {
  id: string
  module_id: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
  user_id: string | null
}

/** Notificaciones (S10): personales o para todo el equipo. */
export default async function NotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'notifications')

  const notices = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<NoticeRow[]>`
      select id, module_id, title, body, link, read_at::text, created_at::text, user_id
      from public.notifications
      where tenant_id = ${ctx.tenantId}
        and (user_id = ${ctx.userId} or user_id is null)
      order by read_at is null desc, created_at desc
      limit 100`,
  )

  const sinLeer = notices.filter((n) => !n.read_at).length
  const puedeEditar = exigir(ctx, 'notifications', 'notifications.edit').ok

  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <Shell {...shell} activePath="/notificaciones">
      <div className="max-w-3xl space-y-5">
        <PageHeader
          icon="notifications"
          title="Notificaciones"
          description="Avisos del sistema y de cada modulo. Los que van a todo el equipo llevan su etiqueta."
          meta={
            sinLeer > 0 ? (
              <Badge tone="danger">{sinLeer} sin leer</Badge>
            ) : (
              <Badge tone="success">Todo leido</Badge>
            )
          }
          actions={
            sinLeer > 0 && puedeEditar ? (
              <form action={marcarTodasLeidas}>
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <button
                  type="submit"
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                >
                  <Icon name="done_all" size={18} />
                  Marcar todas leidas
                </button>
              </form>
            ) : undefined
          }
        />

        {notices.length === 0 ? (
          <EmptyState
            icon="notifications_off"
            title="Nada por aqui"
            description="Cuando un modulo tenga algo que decirte — una prueba por vencer, un pedido aprobado — aparecera en esta lista."
          />
        ) : (
          <ul className="space-y-2">
            {notices.map((n) => (
              <li
                key={n.id}
                className={`rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 ${
                  n.read_at ? 'opacity-60' : 'bg-[var(--color-surface-raised)]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--color-text-primary)]">
                        {n.title}
                      </span>
                      <Badge tone="neutral" dot={false}>
                        {n.module_id}
                      </Badge>
                      {n.user_id === null && (
                        <Badge tone="info" dot={false}>
                          todo el equipo
                        </Badge>
                      )}
                    </p>
                    {n.body && (
                      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{n.body}</p>
                    )}
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {fecha(n.created_at)}
                      {n.link && (
                        <>
                          {' · '}
                          <a
                            href={n.link + ctx.demoQs}
                            className="text-[var(--color-text-link)] hover:underline"
                          >
                            Ver
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  {!n.read_at && puedeEditar && (
                    <form action={marcarLeida}>
                      <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                      <input type="hidden" name="id" value={n.id} />
                      <button
                        type="submit"
                        className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-overlay)]"
                      >
                        Leida
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  )
}
