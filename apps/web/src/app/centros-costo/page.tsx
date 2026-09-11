import {
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
import { asignarCostoForm, crearCentroForm, prorratearCostoForm } from './actions'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Centros de costo · REGB ERP' }

interface CentroRow {
  id: string
  code: string
  name: string
  is_active: boolean
  total: string
  asignaciones: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Centros de costo (modulo 23): a que sucursal, departamento o proyecto se le atribuye cada gasto. */
export default async function CentrosCostoPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'cost-centers')

  const [centros] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<CentroRow[]>`
      select cc.id, cc.code, cc.name, cc.is_active,
             coalesce((select sum(a.amount) from public.cost_center_allocations a
                        where a.cost_center_id = cc.id), 0)::text as total,
             (select count(*) from public.cost_center_allocations a
               where a.cost_center_id = cc.id)::text as asignaciones
      from public.cost_centers cc
      where cc.tenant_id = ${ctx.tenantId}
      order by cc.is_active desc, cc.code`
    return [c] as const
  })

  const activos = centros.filter((c) => c.is_active)
  const totalGeneral = centros.reduce((a, c) => a + Number(c.total), 0)
  const puedeCrear = exigir(ctx, 'cost-centers', 'cost-centers.center.create').ok
  const puedeAsignar = exigir(ctx, 'cost-centers', 'cost-centers.allocation.create').ok
  const qs = ctx.demoQs

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/centros-costo">
      <div className="space-y-5">
        <PageHeader
          icon="call_split"
          title="Centros de costo"
          description="A que sucursal, departamento o proyecto se le atribuye cada gasto. El prorrateo reparte un monto entre varios centros y siempre cuadra exacto."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Total asignado" value={`RD$ ${money(totalGeneral)}`} />
          <StatCard label="Centros activos" value={String(activos.length)} />
          <StatCard
            label="Asignaciones"
            value={String(centros.reduce((a, c) => a + Number(c.asignaciones), 0))}
          />
        </section>

        {centros.length === 0 ? (
          <EmptyState
            icon="call_split"
            title="Todavia no hay ningun centro de costo"
            description="Registra el primero abajo -una sucursal, un departamento, un proyecto- y despues asignale gasto."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Centro</TH>
                <TH numeric>Asignaciones</TH>
                <TH numeric>Total</TH>
              </TR>
            </THead>
            <TBody>
              {centros.map((c) => (
                <TR key={c.id} className={c.is_active ? '' : 'opacity-50'}>
                  <TD>
                    <a
                      href={`/centros-costo/${c.id}${qs}`}
                      className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                    >
                      {c.name}
                    </a>
                    <span className="block text-xs text-[var(--color-text-muted)]">{c.code}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{c.asignaciones}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular font-semibold">{money(Number(c.total))}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeAsignar && activos.length >= 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Prorratear un gasto entre varios centros</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={prorratearCostoForm} className="space-y-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Descripcion
                    <input name="description" required minLength={3} placeholder="Alquiler de septiembre" className={claseInput} />
                  </label>
                  <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Monto total
                    <input
                      name="total"
                      required
                      inputMode="decimal"
                      placeholder="0.00"
                      className={`tabular text-right ${claseInput}`}
                    />
                  </label>
                  <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Fecha
                    <input name="allocationDate" type="date" className={claseInput} />
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {activos.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <input type="hidden" name="weightCenterId" value={c.id} />
                      <span className="w-32 shrink-0 truncate text-[var(--color-text-primary)]">{c.name}</span>
                      <input
                        name="weight"
                        inputMode="decimal"
                        placeholder="0"
                        title={`Peso relativo para ${c.name} -no hace falta que sumen 100-`}
                        className={`tabular w-20 text-right ${claseInput}`}
                      />
                    </label>
                  ))}
                </div>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="call_split" size={18} />
                  Prorratear
                </BotonEnvio>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Los pesos no necesitan sumar 100 -se normalizan solos-. Deja en cero el centro que no
                  participa de este gasto.
                </p>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeAsignar && activos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Asignar gasto a un solo centro</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={asignarCostoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Centro
                  <select name="costCenterId" required className={claseInput}>
                    {activos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-44 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input name="description" required minLength={3} placeholder="Reparacion del aire" className={claseInput} />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`tabular text-right ${claseInput}`}
                  />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input name="allocationDate" type="date" className={claseInput} />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="add" size={18} />
                  Asignar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar centro de costo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCentroForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Codigo
                  <input name="code" required placeholder="SUC-01" className={claseInput} />
                </label>
                <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="name" required placeholder="Sucursal Villa Consuelo" className={claseInput} />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
