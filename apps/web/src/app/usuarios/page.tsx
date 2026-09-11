import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { alternarActivoForm, cambiarRolMiembroForm, invitarMiembroForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

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

/**
 * Usuarios (S8): quien esta en el equipo, con que rol, y como invitar.
 * La puerta F2 exige poder invitar a alguien sin documentacion externa.
 */
export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'users')

  const [members, roles] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
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
    const r = await tx<{ id: string; name: string }[]>`
      select id, name from public.roles
      where tenant_id = ${ctx.tenantId} order by name`
    return [m, r] as const
  })

  const puedeCrear = exigir(ctx, 'users', 'users.create').ok
  const puedeEditar = exigir(ctx, 'users', 'users.edit').ok

  return (
    <Shell {...shell} activePath="/usuarios">
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Usuarios</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {members.length} en el equipo · {members.filter((m) => m.is_active).length} con acceso
            activo
          </p>
        </div>

        <Table>
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
                <TD className="font-medium text-[var(--color-text-primary)]">{m.display_name}</TD>
                <TD>{m.email}</TD>
                <TD>{m.job_title ?? '—'}</TD>
                <TD>
                  {puedeEditar ? (
                    <form action={cambiarRolMiembroForm} className="inline">
                      <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
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
                      <BotonEnvio
                        
                        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
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
                      <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                      <input type="hidden" name="userId" value={m.user_id} />
                      <BotonEnvio
                        
                        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                        {m.is_active ? 'Desactivar' : 'Reactivar'}
                      </BotonEnvio>
                    </form>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Invitar a alguien</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={invitarMiembroForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="nombre"
                    required
                    minLength={3}
                    placeholder="Juana Perez"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Correo
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="juana@tuempresa.do"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-44 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Rol
                  <select
                    name="roleId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio
                  
                  className="h-10 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  Invitar
                </BotonEnvio>
              </form>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                La invitacion llega por correo. El rol decide que modulos ve desde el primer login.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
