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
import { fechaCorta, yaVencio } from '@/lib/fechas-rd'
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
  sales_order_id: string | null
  pedido: string | null
  valid_until: string | null
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
      select q.id, q.quote_number, q.version, c.name as customer_name, q.status, q.total::text,
             q.sales_order_id, so.number as pedido, q.valid_until::text
      from public.quotes q
      left join public.customers c on c.id = q.customer_id
      left join public.sales_orders so on so.id = q.sales_order_id
      where q.tenant_id = ${ctx.tenantId} and q.status != 'superseded'
      order by q.created_at desc`
    const cl = await tx<ClienteOption[]>`
      select id, name from public.customers where tenant_id = ${ctx.tenantId} order by name limit 300`
    return { cotizaciones: c, clientes: cl }
  })

  const pendientesAprobacion = cotizaciones.filter((c) => c.status === 'sent').length
  const porConvertir = cotizaciones.filter(
    (c) => c.status === 'approved' && !c.sales_order_id,
  ).length
  const puedeGestionar = exigir(ctx, 'quotes', 'quotes.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/cotizaciones-venta">
      <div className="space-y-5">
        <PageHeader
          icon="description"
          title="Cotizaciones"
          description="Cotiza con los precios de la lista de cada cliente, imprímela para enviársela y, cuando la acepte, conviértela en pedido. Revisar una cotización enviada crea una versión nueva: la anterior queda en el historial."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Cotizaciones" value={String(cotizaciones.length)} />
          <StatCard
            label="Esperando al cliente"
            value={String(pendientesAprobacion)}
            hint="enviadas, sin respuesta"
          />
          <StatCard
            label="Aprobadas sin pedido"
            value={String(porConvertir)}
            hint="conviértelas en pedido"
          />
        </section>

        {cotizaciones.length === 0 ? (
          <EmptyState
            icon="description"
            title="Todavía no hay ninguna cotización"
            description="Crea la primera abajo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cotización</TH>
                <TH>Cliente</TH>
                <TH>Válida hasta</TH>
                <TH numeric>Total</TH>
                <TH>Estado</TH>
                <TH>
                  <span className="sr-only">Imprimir</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {cotizaciones.map((c) => (
                <TR key={c.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a
                      href={`/cotizaciones-venta/${c.id}${qs}`}
                      className="text-[var(--color-text-link)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                    >
                      <Mono>{c.quote_number}</Mono> v{c.version}
                    </a>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">{c.customer_name ?? '—'}</TD>
                  <TD className="whitespace-nowrap">
                    {c.valid_until ? (
                      <>
                        {fechaCorta(c.valid_until, true)}
                        {/* Enviada y ya sin vigencia: hay que llamar o
                            marcarla vencida, no esperar respuesta. */}
                        {c.status === 'sent' && yaVencio(c.valid_until) && (
                          <span className="block text-[10px] text-[var(--color-semantic-text-danger)]">
                            ya venció
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--color-text-muted)]">Sin fecha</span>
                    )}
                  </TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(c.total))}</span>
                  </TD>
                  <TD>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={badgeEstado(c.status)}>
                        {ESTADO_COTIZACION[c.status] ?? c.status}
                      </Badge>
                      {c.sales_order_id && c.pedido && (
                        <a
                          href={`/pedidos/${c.sales_order_id}${qs}`}
                          className="text-xs text-[var(--color-text-link)] hover:underline"
                        >
                          Pedido {c.pedido}
                        </a>
                      )}
                    </span>
                  </TD>
                  <TD>
                    <a
                      href={`/cotizaciones-venta/${c.id}/imprimir${qs}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Imprimir ${c.quote_number} v${c.version}`}
                      title="Imprimir o guardar en PDF"
                      className="grid h-8 w-8 place-items-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                    >
                      <Icon name="print" size={16} />
                    </a>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva cotización</CardTitle>
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
                    <option value="">Sin cliente todavía</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Válida hasta (opcional)
                  <input
                    type="date"
                    name="validUntil"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Términos (opcional)
                  <input
                    name="terms"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
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
