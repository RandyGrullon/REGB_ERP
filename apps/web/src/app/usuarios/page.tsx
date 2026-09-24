import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { authConfigured } from '@/lib/supabase'
import { Shell } from '@/components/Shell'
import { alternarActivoForm, cambiarRolMiembroForm, revocarInvitacionForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'
import { InvitarForm, ReenviarInvitacion } from './InvitacionUI'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Usuarios · REGB ERP' }

interface MemberRow {
  user_id: string
  display_name: string
  email: string
  job_title: string | null
  role_id: string
  role_name: string
  is_active: boolean
  invited_at: string | null
  accepted_at: string | null
}

interface InvitacionRow {
  id: string
  display_name: string
  email: string
  role_name: string
  expires_at: Date
  sent_at: Date | null
  vencida: boolean
}

const fecha = new Intl.DateTimeFormat('es-DO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Santo_Domingo',
})

const BOTON_FILA =
  'inline-flex h-11 items-center rounded-full border border-[var(--color-border)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)] disabled:opacity-50'

/**
 * Usuarios (S8): quien esta en el equipo, con que rol, y como invitar.
 * La puerta F2 exige poder invitar a alguien sin documentacion externa.
 *
 * Desde 0123 una invitacion NO es una fila de `memberships`: vive en
 * `user_invitations` hasta que la persona la acepta con su cuenta. Por eso
 * la pantalla tiene dos listas -el equipo y quien esta invitado- y nunca
 * dice "enviada" si el correo no salio de verdad (`sent_at`).
 */
export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'users')

  const [members, roles, invitaciones] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const m = await tx<MemberRow[]>`
      select p.user_id, p.display_name, p.email, p.job_title,
             ms.role_id, r.name as role_name, ms.is_active,
             ms.invited_at::text, ms.accepted_at::text
      from public.user_profiles p
      join public.memberships ms
        on ms.tenant_id = p.tenant_id and ms.user_id = p.user_id
      join public.roles r on r.id = ms.role_id
      where p.tenant_id = ${ctx.tenantId}
      order by p.display_name`
    const r = await tx<{ id: string; name: string; visible_modules: string[] }[]>`
      select id, name, visible_modules from public.roles
      where tenant_id = ${ctx.tenantId} order by name`
    // Columnas nombradas: `token_hash` no tiene grant para authenticated.
    const i = await tx<InvitacionRow[]>`
      select i.id, i.display_name, i.email, r.name as role_name,
             i.expires_at, i.sent_at, i.expires_at <= now() as vencida
      from public.user_invitations i
      join public.roles r on r.id = i.role_id
      where i.tenant_id = ${ctx.tenantId} and i.status = 'pending'
      order by i.created_at desc`
    return [m, r, i] as const
  })

  const puedeCrear = exigir(ctx, 'users', 'users.create').ok
  const puedeEditar = exigir(ctx, 'users', 'users.edit').ok
  const tenantDemo = ctx.demoQs ? ctx.tenantSlug : ''
  const rolDemo = ctx.demoQs ? ctx.roleName : ''

  // Para invitar, solo los roles que verian algo en ESTE negocio. Un
  // colmado con caja e inventario no tiene por que elegir entre "RRHH",
  // "Tecnico de Campo" o "Cliente Externo": roles de modulos que no tiene.
  const activos = new Set(shell.data.activeModules)
  const rolesParaInvitar = roles
    .filter((r) => r.visible_modules.includes('*') || r.visible_modules.some((m) => activos.has(m)))
    .map(({ id, name }) => ({ id, name }))

  return (
    <Shell {...shell} activePath="/usuarios">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Usuarios</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {members.length} en el equipo · {members.filter((m) => m.is_active).length} con acceso
            activo · {invitaciones.length}{' '}
            {invitaciones.length === 1 ? 'invitación pendiente' : 'invitaciones pendientes'}
          </p>
        </div>

        <Table>
          <caption className="sr-only">Personas del equipo</caption>
          <THead>
            <TR>
              <TH>Nombre</TH>
              <TH>Correo</TH>
              <TH>Puesto</TH>
              <TH>Rol</TH>
              <TH>Estado</TH>
              {puedeEditar && (
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              )}
            </TR>
          </THead>
          <TBody>
            {members.map((m) => (
              <TR key={m.user_id}>
                <TD className="font-semibold text-[var(--color-text-primary)]">{m.display_name}</TD>
                <TD>{m.email}</TD>
                <TD>{m.job_title ?? '—'}</TD>
                <TD>
                  {puedeEditar ? (
                    <form action={cambiarRolMiembroForm} className="inline">
                      <input type="hidden" name="tenant" value={tenantDemo} />
                      <input type="hidden" name="rol" value={rolDemo} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <select
                        name="roleId"
                        defaultValue={m.role_id}
                        aria-label={`Rol de ${m.display_name}`}
                        className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>{' '}
                      <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                        Cambiar
                      </BotonEnvio>
                    </form>
                  ) : (
                    m.role_name
                  )}
                </TD>
                <TD>
                  <Badge tone={m.is_active ? 'success' : 'neutral'}>
                    {m.is_active ? 'Activo' : 'Desactivado'}
                  </Badge>
                  {m.invited_at && !m.accepted_at && (
                    <Badge tone="info" dot={false} className="ml-1">
                      invitado
                    </Badge>
                  )}
                </TD>
                {puedeEditar && (
                  <TD>
                    <form action={alternarActivoForm} className="inline">
                      <input type="hidden" name="tenant" value={tenantDemo} />
                      <input type="hidden" name="rol" value={rolDemo} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                        {m.is_active ? 'Desactivar' : 'Reactivar'}
                      </BotonEnvio>
                    </form>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>

        <Card>
          <CardHeader>
            <CardTitle id="invitaciones-titulo">Invitaciones pendientes</CardTitle>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Todavia no son parte del equipo: entran cuando abren su enlace con el correo invitado.
            </p>
          </CardHeader>
          <CardBody>
            {invitaciones.length === 0 ? (
              <EmptyState
                icon="mark_email_unread"
                title="Nadie esperando en la puerta"
                description="Cuando invites a alguien, su invitacion espera aqui hasta que la acepte. Sin papeles ni llamadas."
                tourHref={`/tutorial${ctx.demoQs}`}
                tourLabel="Como funcionan los permisos"
                className="py-8"
              />
            ) : (
              <ul
                aria-labelledby="invitaciones-titulo"
                className="divide-y divide-[var(--color-border)]"
              >
                {invitaciones.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-56 flex-1">
                      <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {inv.display_name}
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">
                        {inv.email} · {inv.role_name}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      {inv.vencida ? (
                        <Badge tone="danger">Vencida el {fecha.format(inv.expires_at)}</Badge>
                      ) : inv.sent_at ? (
                        <Badge tone="success">Correo enviado el {fecha.format(inv.sent_at)}</Badge>
                      ) : (
                        <Badge tone="warning">Sin enviar por correo</Badge>
                      )}
                      {!inv.vencida && (
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          Vence el {fecha.format(inv.expires_at)}
                        </span>
                      )}
                    </div>
                    {puedeCrear && (
                      <>
                        <ReenviarInvitacion
                          tenant={tenantDemo}
                          rol={rolDemo}
                          invitationId={inv.id}
                          nombre={inv.display_name}
                        />
                        <form action={revocarInvitacionForm}>
                          <input type="hidden" name="tenant" value={tenantDemo} />
                          <input type="hidden" name="rol" value={rolDemo} />
                          <input type="hidden" name="invitationId" value={inv.id} />
                          <BotonEnvio
                            aria-label={`Revocar la invitación de ${inv.display_name}`}
                            className={BOTON_FILA}
                          >
                            Revocar
                          </BotonEnvio>
                        </form>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {puedeCrear && (
          <Card data-tour="usuario-invitar">
            <CardHeader>
              <CardTitle>Invitar a alguien</CardTitle>
            </CardHeader>
            <CardBody>
              <InvitarForm
                tenant={tenantDemo}
                rol={rolDemo}
                roles={rolesParaInvitar}
                modoDemo={!authConfigured}
              />
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
