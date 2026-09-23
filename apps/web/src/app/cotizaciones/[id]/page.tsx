import { notFound } from 'next/navigation'
import {
  Badge,
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
import { mejorCotizacion } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { adjudicarRfqForm, invitarProveedorForm, registrarCotizacionForm } from '../actions'
import { ESTADO_RFQ } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface RfqHead {
  id: string
  title: string
  description: string | null
  status: string
}

interface CotizacionRow {
  id: string
  supplier_id: string
  supplier_name: string
  total_amount: string
  lead_time_days: number
  notes: string | null
}

interface ProveedorOption {
  id: string
  name: string
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Comparativo de cotizaciones de un RFQ (modulo 44): gana el monto mas bajo, siempre igual. */
export default async function RfqDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'rfq')

  const { rfq, cotizaciones, proveedores } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [head] = await tx<RfqHead[]>`
      select id, title, description, status from public.rfqs where id = ${id} and tenant_id = ${ctx.tenantId}`

    if (!head) return { rfq: null, cotizaciones: [], proveedores: [] }

    const q = await tx<CotizacionRow[]>`
      select rq.id, rq.supplier_id, s.name as supplier_name, rq.total_amount::text, rq.lead_time_days, rq.notes
      from public.rfq_quotes rq
      join public.suppliers s on s.id = rq.supplier_id
      where rq.tenant_id = ${ctx.tenantId} and rq.rfq_id = ${id}
      order by rq.total_amount`

    const p = await tx<ProveedorOption[]>`
      select id, name from public.suppliers where tenant_id = ${ctx.tenantId} and is_active order by name`

    return { rfq: head, cotizaciones: q, proveedores: p }
  })

  if (!rfq) notFound()

  const ganador = mejorCotizacion(
    cotizaciones.map((c) => ({
      supplierId: c.supplier_id,
      totalAmount: Number(c.total_amount),
      leadTimeDays: c.lead_time_days,
    })),
  )

  const puedeGestionar = exigir(ctx, 'rfq', 'rfq.manage').ok
  const puedeAdjudicar = exigir(ctx, 'rfq', 'rfq.award').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/cotizaciones">
      <div className="space-y-5">
        <PageHeader
          icon="compare_arrows"
          title={rfq.title}
          description={rfq.description ?? ''}
          crumbs={[{ label: 'Cotizaciones', href: `/cotizaciones${qs}` }, { label: rfq.title }]}
          actions={<Badge tone={rfq.status === 'awarded' ? 'success' : 'warning'}>{ESTADO_RFQ[rfq.status] ?? rfq.status}</Badge>}
        />

        {cotizaciones.length === 0 ? (
          <EmptyState icon="request_quote" title="Todavia no hay ninguna cotizacion registrada" description="" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Proveedor</TH>
                <TH numeric>Monto total</TH>
                <TH numeric>Plazo de entrega</TH>
                <TH>Notas</TH>
                {rfq.status === 'open' && puedeAdjudicar && (
                  <TH>
                    <span className="sr-only">Accion</span>
                  </TH>
                )}
              </TR>
            </THead>
            <TBody>
              {cotizaciones.map((c) => (
                <TR key={c.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    {c.supplier_name}
                    {c.supplier_id === ganador && (
                      <Badge tone="success">Mejor oferta</Badge>
                    )}
                  </TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(c.total_amount))}</span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{c.lead_time_days} dias</span>
                  </TD>
                  <TD className="max-w-56 truncate">{c.notes ?? '—'}</TD>
                  {rfq.status === 'open' && puedeAdjudicar && (
                    <TD>
                      <form action={adjudicarRfqForm}>
                        <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                        <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                        <input type="hidden" name="rfqId" value={rfq.id} />
                        <input type="hidden" name="supplierId" value={c.supplier_id} />
                        <BotonEnvio
                          
                          className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                          <Icon name="emoji_events" size={14} />
                          Adjudicar
                        </BotonEnvio>
                      </form>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && rfq.status === 'open' && proveedores.length > 0 && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Invitar proveedor</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={invitarProveedorForm} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="rfqId" value={rfq.id} />
                  <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Proveedor
                    <select name="supplierId" required className={claseInput}>
                      {proveedores.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                    <Icon name="mail" size={14} />
                    Invitar
                  </BotonEnvio>
                </form>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Registrar cotizacion</CardTitle>
              </CardHeader>
              <CardBody>
                <form action={registrarCotizacionForm} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                  <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                  <input type="hidden" name="rfqId" value={rfq.id} />
                  <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Proveedor
                    <select name="supplierId" required className={claseInput}>
                      {proveedores.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Monto total
                    <input name="totalAmount" required inputMode="decimal" className={`tabular ${claseInput}`} />
                  </label>
                  <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Plazo (dias)
                    <input name="leadTimeDays" required inputMode="numeric" className={`tabular ${claseInput}`} />
                  </label>
                  <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                    Notas
                    <input name="notes" className={claseInput} />
                  </label>
                  <BotonEnvio
                    
                    className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                    <Icon name="send" size={14} />
                    Registrar
                  </BotonEnvio>
                </form>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </Shell>
  )
}
