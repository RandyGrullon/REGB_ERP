import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  Mono,
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
import { crearCotizacionForm } from './actions'
import { ESTADO_COTIZACION } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cotizaciones · REGB ERP' }

interface CotizacionRow {
  id: string
  quote_number: string
  version: number
  customer_name: string | null
  status: string
  total: string
}

interface ClienteOption {
  id: string
  name: string
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'approved') return 'success'
  if (s === 'rejected' || s === 'expired') return 'danger'
  if (s === 'sent') return 'warning'
  return 'neutral'
}

/** Cotizaciones (modulo 31): versiones reales, contenido congelado al enviar. */
export default async function CotizacionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'quotes')

  const { cotizaciones, clientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<CotizacionRow[]>`
      select q.id, q.quote_number, q.version, c.name as customer_name, q.status, q.total::text
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      where q.tenant_id = ${ctx.tenantId} and q.status != 'superseded'
      order by q.created_at desc`
    const cl = await tx<ClienteOption[]>`
      select id, name from public.customers where tenant_id = ${ctx.tenantId} order by name limit 300`
    return { cotizaciones: c, clientes: cl }
  })

  const pendientesAprobacion = cotizaciones.filter((c) => c.status === 'sent').length
  const puedeGestionar = exigir(ctx, 'quotes', 'quotes.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/cotizaciones-venta">
      <div className="space-y-5">
        <PageHeader
          icon="description"
          title="Cotizaciones"
          description="Cada version queda en el historial -revisar una cotizacion nunca sobrescribe la anterior-. Los mismos totales que usan pedidos, POS y facturas."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Cotizaciones" value={String(cotizaciones.length)} />
          <StatCard label="Esperando aprobacion" value={String(pendientesAprobacion)} />
        </section>

        {cotizaciones.length === 0 ? (
          <EmptyState icon="description" title="Todavia no hay ninguna cotizacion" description="Crea la primera abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cotizacion</TH>
                <TH>Cliente</TH>
                <TH numeric>Total</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {cotizaciones.map((c) => (
                <TR key={c.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/cotizaciones-venta/${c.id}${qs}`} className="underline-offset-2 hover:underline">
                      <Mono>{c.quote_number}</Mono> v{c.version}
                    </a>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">{c.customer_name ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(c.total))}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(c.status)}>{ESTADO_COTIZACION[c.status] ?? c.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva cotizacion</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearCotizacionForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente (opcional)
                  <select
                    name="customerId"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="">Sin cliente todavia</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Valida hasta (opcional)
                  <input
                    type="date"
                    name="validUntil"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Terminos (opcional)
                  <input
                    name="terms"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
