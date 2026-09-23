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
import { proximoConteoVencido, type ClaseAbc } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { iniciarConteoForm, recalcularAbcForm } from './actions'
import { ESTADO_CONTEO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conteos ciclicos · REGB ERP' }

interface AlmacenOption {
  id: string
  name: string
}

interface ProgramacionRow {
  product_id: string
  sku: string
  name: string
  abc_class: ClaseAbc
  frequency_days: number
  last_counted_at: string | null
}

interface ConteoRow {
  id: string
  warehouse_name: string
  status: string
  started_at: string
  lineas: string
}

const badgeAbc = (clase: ClaseAbc): 'danger' | 'warning' | 'neutral' =>
  clase === 'A' ? 'danger' : clase === 'B' ? 'warning' : 'neutral'

const badgeEstado = (estado: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (estado === 'approved') return 'success'
  if (estado === 'pending_approval') return 'warning'
  if (estado === 'rejected') return 'danger'
  return 'neutral'
}

/** Conteos ciclicos (modulo 51): programacion ABC real, conteo ciego, ajuste con aprobacion. */
export default async function ConteosCiclicosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'stock-counts')

  const { almacenes, programacion, conteos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const a = await tx<AlmacenOption[]>`
      select id, name from public.warehouses
      where tenant_id = ${ctx.tenantId} and is_active order by is_default desc, name`
    const p = await tx<ProgramacionRow[]>`
      select cs.product_id, pr.sku, pr.name, cs.abc_class, cs.frequency_days, cs.last_counted_at::text
      from public.count_schedules cs
      join public.products pr on pr.id = cs.product_id
      where cs.tenant_id = ${ctx.tenantId}
      order by cs.abc_class, pr.name`
    const c = await tx<ConteoRow[]>`
      select cc.id, w.name as warehouse_name, cc.status, cc.started_at::text,
             (select count(*) from public.cycle_count_lines l where l.count_id = cc.id)::text as lineas
      from public.cycle_counts cc
      join public.warehouses w on w.id = cc.warehouse_id
      where cc.tenant_id = ${ctx.tenantId}
      order by cc.started_at desc
      limit 30`
    return { almacenes: a, programacion: p, conteos: c }
  })

  const ahora = new Date()
  const vencidos = programacion.filter((p) =>
    proximoConteoVencido(p.last_counted_at ? new Date(p.last_counted_at) : null, p.frequency_days, ahora),
  ).length
  const pendientesAprobacion = conteos.filter((c) => c.status === 'pending_approval').length

  const puedeGestionar = exigir(ctx, 'stock-counts', 'stock-counts.manage').ok
  const qs = ctx.demoQs

  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('es-DO') : 'Nunca'

  return (
    <Shell {...shell} activePath="/conteos-ciclicos">
      <div className="space-y-5">
        <PageHeader
          icon="checklist"
          title="Conteos ciclicos"
          description="Clasificacion ABC real, conteo ciego -quien cuenta no ve el numero del sistema-, y el ajuste espera aprobacion antes de tocar el inventario."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Productos programados" value={String(programacion.length)} />
          <StatCard label="Vencidos para contar" value={String(vencidos)} />
          <StatCard label="Esperando aprobacion" value={String(pendientesAprobacion)} />
          <StatCard label="Conteos totales" value={String(conteos.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Programacion ABC</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {programacion.length === 0 ? (
              <EmptyState
                icon="checklist"
                title="Todavia no hay clasificacion ABC"
                description="Calculala abajo a partir del valor actual en inventario."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Producto</TH>
                    <TH>Clase</TH>
                    <TH numeric>Frecuencia</TH>
                    <TH>Ultimo conteo</TH>
                  </TR>
                </THead>
                <TBody>
                  {programacion.map((p) => {
                    const vencido = proximoConteoVencido(
                      p.last_counted_at ? new Date(p.last_counted_at) : null,
                      p.frequency_days,
                      ahora,
                    )
                    return (
                      <TR key={p.product_id}>
                        <TD className="text-[var(--color-text-primary)]">{p.sku} — {p.name}</TD>
                        <TD>
                          <Badge tone={badgeAbc(p.abc_class)}>{p.abc_class}</Badge>
                        </TD>
                        <TD numeric>
                          <span className="tabular">cada {p.frequency_days} dias</span>
                        </TD>
                        <TD>
                          {fecha(p.last_counted_at)}
                          {vencido && (
                            <Badge tone="warning" className="ml-1">
                              Vencido
                            </Badge>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
            {puedeGestionar && (
              <form action={recalcularAbcForm} className="border-t border-[var(--color-border)] p-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                  <Icon name="refresh" size={14} />
                  Recalcular clasificacion ABC
                </BotonEnvio>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Usa el valor actual en inventario (costo promedio × existencia) de cada
                  producto, no el historial de ventas -esa integracion es un paso futuro-.
                </p>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conteos</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {conteos.length === 0 ? (
              <EmptyState icon="checklist" title="Todavia no hay ningun conteo" description="" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Almacen</TH>
                    <TH numeric>Productos</TH>
                    <TH>Estado</TH>
                    <TH>Iniciado</TH>
                  </TR>
                </THead>
                <TBody>
                  {conteos.map((c) => (
                    <TR key={c.id}>
                      <TD className="text-[var(--color-text-primary)]">
                        <a
                          href={`/conteos-ciclicos/${c.id}${qs}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {c.warehouse_name}
                        </a>
                      </TD>
                      <TD numeric>
                        <span className="tabular">{c.lineas}</span>
                      </TD>
                      <TD>
                        <Badge tone={badgeEstado(c.status)}>
                          {ESTADO_CONTEO[c.status] ?? c.status}
                        </Badge>
                      </TD>
                      <TD>{fecha(c.started_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {puedeGestionar && almacenes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Iniciar conteo</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={iniciarConteoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Almacen
                  <select
                    name="warehouseId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {almacenes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Iniciar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
