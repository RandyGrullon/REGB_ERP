import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  PageHeader,
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
import { guardarGeocercaForm } from '../actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Geocercas · REGB ERP' }

interface GeocercaRow {
  branch_id: string
  branch_name: string
  latitude: string
  longitude: string
  radius_meters: number
}

interface SucursalOption {
  id: string
  name: string
}

/** Geocercas (modulo 63): el centro y el radio permitido para marcar por sucursal. */
export default async function GeocercasPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'attendance')

  const [geocercas, sucursales] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const g = await tx<GeocercaRow[]>`
      select g.branch_id, b.name as branch_name, g.latitude::text, g.longitude::text, g.radius_meters
      from public.attendance_geofences g
      join public.branches b on b.id = g.branch_id
      where g.tenant_id = ${ctx.tenantId}
      order by b.name`

    const s = await tx<SucursalOption[]>`
      select id, name from public.branches where tenant_id = ${ctx.tenantId} order by name`

    return [g, s] as const
  })

  const puedeAdministrar = exigir(ctx, 'attendance', 'attendance.geofence.manage').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/asistencia">
      <div className="space-y-5">
        <PageHeader
          icon="fence"
          title="Geocercas"
          description="El centro y el radio permitido para que un marcaje cuente como dentro de la sucursal."
          crumbs={[{ label: 'Asistencia', href: `/asistencia${qs}` }, { label: 'Geocercas' }]}
        />

        {geocercas.length === 0 ? (
          <EmptyState
            icon="fence"
            title="Todavia no hay ninguna geocerca configurada"
            description="Sin una geocerca, el marcaje de esa sucursal siempre queda como manual, sin validar la posicion."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Sucursal</TH>
                <TH numeric>Latitud</TH>
                <TH numeric>Longitud</TH>
                <TH numeric>Radio</TH>
              </TR>
            </THead>
            <TBody>
              {geocercas.map((g) => (
                <TR key={g.branch_id}>
                  <TD className="text-[var(--color-text-primary)]">{g.branch_name}</TD>
                  <TD numeric>
                    <span className="tabular">{g.latitude}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{g.longitude}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{g.radius_meters} m</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeAdministrar && sucursales.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Configurar geocerca</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={guardarGeocercaForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Sucursal
                  <select name="branchId" required className={claseInput}>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Latitud
                  <input name="lat" required inputMode="decimal" placeholder="18.4861" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Longitud
                  <input name="lng" required inputMode="decimal" placeholder="-69.9312" className={`tabular ${claseInput}`} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Radio (m)
                  <input name="radius" required inputMode="numeric" placeholder="100" className={`tabular ${claseInput}`} />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="save" size={18} />
                  Guardar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
