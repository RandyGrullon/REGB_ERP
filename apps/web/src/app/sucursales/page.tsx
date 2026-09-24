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
  Mono,
} from '@regb/ui'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { alternarSucursalForm, crearSucursalForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sucursales · REGB ERP' }

interface BranchRow {
  id: string
  name: string
  code: string | null
  address: string | null
  is_active: boolean
  company_name: string
}

/** Sucursales (S9): las ubicaciones fisicas de cada empresa. */
export default async function SucursalesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'branches')

  const [branches, companies] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const b = await tx<BranchRow[]>`
      select b.id, b.name, b.code, b.address, b.is_active,
             c.legal_name as company_name
      from public.branches b
      join public.companies c on c.id = b.company_id
      where b.tenant_id = ${ctx.tenantId} and b.deleted_at is null
      order by c.legal_name, b.name`
    const c = await tx<{ id: string; legal_name: string }[]>`
      select id, legal_name from public.companies
      where tenant_id = ${ctx.tenantId} and deleted_at is null
      order by is_default desc, legal_name`
    return [b, c] as const
  })

  const puedeCrear = exigir(ctx, 'branches', 'branches.create').ok
  const puedeEditar = exigir(ctx, 'branches', 'branches.edit').ok

  return (
    <Shell {...shell} activePath="/sucursales">
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Sucursales</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {branches.filter((b) => b.is_active).length} activas de {branches.length}. Cada rol
            puede limitarse a sucursales concretas desde Roles y permisos.
          </p>
        </div>

        <Table>
          <THead>
            <TR>
              <TH>Sucursal</TH>
              <TH>Código</TH>
              <TH>Empresa</TH>
              <TH>Dirección</TH>
              <TH>Estado</TH>
              {puedeEditar && (
                <TH>
                  <span className="sr-only">Acciones</span>
                </TH>
              )}
            </TR>
          </THead>
          <TBody>
            {branches.map((b) => (
              <TR key={b.id}>
                <TD className="font-medium text-[var(--color-text-primary)]">{b.name}</TD>
                <TD>{b.code ? <Mono>{b.code}</Mono> : '—'}</TD>
                <TD>{b.company_name}</TD>
                <TD>{b.address ?? '—'}</TD>
                <TD>
                  <Badge tone={b.is_active ? 'success' : 'neutral'}>
                    {b.is_active ? 'Activa' : 'Cerrada'}
                  </Badge>
                </TD>
                {puedeEditar && (
                  <TD>
                    <form action={alternarSucursalForm} className="inline">
                      <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                      <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                      <input type="hidden" name="id" value={b.id} />
                      <BotonEnvio className="rounded-full border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                        {b.is_active ? 'Cerrar' : 'Reabrir'}
                      </BotonEnvio>
                    </form>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>

        {puedeCrear && (
          <Card data-tour="sucursal-nueva">
            <CardHeader>
              <CardTitle>Abrir sucursal</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearSucursalForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={ctx.demoQs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={ctx.demoQs ? ctx.roleName : ''} />
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input
                    name="nombre"
                    required
                    minLength={2}
                    placeholder="Sucursal Santiago"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-24 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Codigo
                  <input
                    name="codigo"
                    placeholder="STI"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex w-56 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Empresa
                  <select
                    name="companyId"
                    required
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-sm text-[var(--color-text-primary)]"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legal_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Direccion
                  <input
                    name="direccion"
                    placeholder="Av. 27 de Febrero #123"
                    className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="h-10 rounded-full bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  Abrir
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
