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
import { unirFrases } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'

interface RfqHead {
  id: string
  title: string
  description: string | null
  status: string
  deadline: string | null
  created_at: string
  awarded_at: string | null
  awarded_name: string | null
}

interface CotizacionRow {
  id: string
  supplier_id: string
  supplier_name: string
  total_amount: string
  lead_time_days: number
  notes: string | null
  submitted_at: string
  phone: string | null
}

interface ProveedorOption {
  id: string
  name: string
}

interface InvitacionRow {
  supplier_id: string
  supplier_name: string
  invited_at: string
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

  const { rfq, cotizaciones, proveedores, invitados } = await asUser(
    ctx.userId,
    ctx.tenantId,
    async (tx) => {
      const [head] = await tx<RfqHead[]>`
      select r.id, r.title, r.description, r.status, r.deadline::text, r.created_at::text,
             r.awarded_at::text, s.name as awarded_name
      from public.rfqs r
      left join public.suppliers s on s.id = r.awarded_supplier_id
      where r.id = ${id} and r.tenant_id = ${ctx.tenantId}`

      if (!head) return { rfq: null, cotizaciones: [], proveedores: [], invitados: [] }

      const q = await tx<CotizacionRow[]>`
      select rq.id, rq.supplier_id, s.name as supplier_name, rq.total_amount::text, rq.lead_time_days,
             rq.notes, rq.submitted_at::text, s.phone
      from public.rfq_quotes rq
      join public.suppliers s on s.id = rq.supplier_id
      where rq.tenant_id = ${ctx.tenantId} and rq.rfq_id = ${id}
      order by rq.total_amount`

      const p = await tx<ProveedorOption[]>`
      select id, name from public.suppliers where tenant_id = ${ctx.tenantId} and is_active order by name`

      // Antes "Invitar" guardaba la invitacion y no se veia en ningun lado:
      // parecia un boton muerto y no habia forma de saber a quien faltaba
      // pedirle precio.
      const i = await tx<InvitacionRow[]>`
      select ri.supplier_id, s.name as supplier_name, ri.invited_at::text
      from public.rfq_invitations ri
      join public.suppliers s on s.id = ri.supplier_id
      where ri.tenant_id = ${ctx.tenantId} and ri.rfq_id = ${id}
      order by ri.invited_at`

      return { rfq: head, cotizaciones: q, proveedores: p, invitados: i }
    },
  )

  if (!rfq) notFound()

  const ganador = mejorCotizacion(
    cotizaciones.map((c) => ({
      supplierId: c.supplier_id,
      totalAmount: Number(c.total_amount),
      leadTimeDays: c.lead_time_days,
    })),
  )

  const puedeGestionar = exigir(ctx, 'rfq', 'rfq.manage').ok
  // A quien todavia no se invito, y quien todavia no cotizo: invitar dos
  // veces al mismo o registrarle una segunda cotizacion rebota en la base.
  const porInvitar = proveedores.filter((p) => !invitados.some((i) => i.supplier_id === p.id))
  const porCotizar = proveedores.filter((p) => !cotizaciones.some((c) => c.supplier_id === p.id))
  const puedeAdjudicar = exigir(ctx, 'rfq', 'rfq.award').ok
  const qs = ctx.demoQs
  const dia = (iso: string, utc = false) =>
    new Date(iso).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(utc ? { timeZone: 'UTC' } : {}),
    })
  const montos = cotizaciones.map((c) => Number(c.total_amount))
  const ahorro = montos.length > 1 ? Math.max(...montos) - Math.min(...montos) : 0
  const resumen = [
    `Pedida el ${dia(rfq.created_at)}`,
    rfq.deadline ? `se reciben precios hasta el ${dia(rfq.deadline, true)}` : null,
    rfq.awarded_at && rfq.awarded_name
      ? `adjudicada a ${rfq.awarded_name} el ${dia(rfq.awarded_at)}`
      : null,
  ].filter(Boolean)

  return (
    <Shell {...shell} activePath="/cotizaciones">
      <div className="space-y-5">
        <PageHeader
          icon="compare_arrows"
          title={rfq.title}
          description={unirFrases([rfq.description, resumen.join(' · ')])}
          crumbs={[{ label: 'Cotizaciones', href: `/cotizaciones${qs}` }, { label: rfq.title }]}
          actions={
            <Badge
              tone={
                rfq.status === 'awarded'
                  ? 'success'
                  : rfq.status === 'cancelled'
                    ? 'danger'
                    : 'warning'
              }
            >
              {ESTADO_RFQ[rfq.status] ?? rfq.status}
            </Badge>
          }
        />

        {cotizaciones.length === 0 ? (
          <EmptyState
            icon="request_quote"
            title="Todavía no hay ninguna cotización registrada"
            description="Invita a los proveedores abajo y, cuando te manden su precio, regístralo aquí con su plazo de entrega. El comparativo se arma solo."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Proveedor</TH>
                <TH numeric>Monto total</TH>
                <TH numeric>Plazo de entrega</TH>
                <TH numeric>Diferencia</TH>
                <TH>Notas</TH>
                {rfq.status === 'open' && puedeAdjudicar && (
                  <TH>
                    <span className="sr-only">Acción</span>
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
                      <Badge tone="success" className="ml-2">
                        Mejor oferta
                      </Badge>
                    )}
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      cotizó el {dia(c.submitted_at)}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular whitespace-nowrap">
                      RD$ {money(Number(c.total_amount))}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">
                      {c.lead_time_days === 1 ? '1 día' : `${c.lead_time_days} días`}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular whitespace-nowrap text-[var(--color-text-muted)]">
                      {Number(c.total_amount) === Math.min(...montos)
                        ? '—'
                        : `+ RD$ ${money(Number(c.total_amount) - Math.min(...montos))}`}
                    </span>
                  </TD>
                  <TD className="max-w-72">
                    <span className="line-clamp-2" title={c.notes ?? undefined}>
                      {c.notes ?? '—'}
                    </span>
                  </TD>
                  {rfq.status === 'open' && puedeAdjudicar && (
                    <TD>
                      {/* Solo la mejor oferta: la regla del modulo es que gana
                          el monto más bajo, no quien compra. El servidor lo
                          vuelve a comprobar. */}
                      {c.supplier_id === ganador && (
                        <form action={adjudicarRfqForm}>
                          <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                          <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                          <input type="hidden" name="rfqId" value={rfq.id} />
                          <input type="hidden" name="supplierId" value={c.supplier_id} />
                          <BotonEnvio className="flex h-8 items-center gap-1 rounded-full bg-[var(--color-brand)] px-2 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                            <Icon name="emoji_events" size={14} />
                            Adjudicar
                          </BotonEnvio>
                        </form>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {cotizaciones.length > 1 && ahorro > 0 && (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Entre la oferta más cara y la más barata hay{' '}
            <span className="tabular font-semibold text-[var(--color-text-primary)]">
              RD$ {money(ahorro)}
            </span>{' '}
            de diferencia.
          </p>
        )}

        {invitados.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Invitados</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Proveedor</TH>
                    <TH>Invitado</TH>
                    <TH>Cotización</TH>
                  </TR>
                </THead>
                <TBody>
                  {invitados.map((i) => {
                    const cotizo = cotizaciones.some((c) => c.supplier_id === i.supplier_id)
                    return (
                      <TR key={i.supplier_id}>
                        <TD className="text-[var(--color-text-primary)]">{i.supplier_name}</TD>
                        <TD>
                          {new Date(i.invited_at).toLocaleDateString('es-DO', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </TD>
                        <TD>
                          <Badge tone={cotizo ? 'success' : 'warning'}>
                            {cotizo ? 'Ya cotizó' : 'Esperando precio'}
                          </Badge>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        )}

        {puedeGestionar && rfq.status === 'open' && proveedores.length > 0 && (
          <>
            {porInvitar.length > 0 && (
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
                        {porInvitar.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]">
                      <Icon name="mail" size={14} />
                      Invitar
                    </BotonEnvio>
                  </form>
                </CardBody>
              </Card>
            )}

            {porCotizar.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Registrar cotización</CardTitle>
                </CardHeader>
                <CardBody>
                  <form action={registrarCotizacionForm} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                    <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                    <input type="hidden" name="rfqId" value={rfq.id} />
                    <label className="flex min-w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Proveedor
                      <select name="supplierId" required className={claseInput}>
                        {porCotizar.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Monto total
                      <input
                        name="totalAmount"
                        required
                        inputMode="decimal"
                        className={`tabular ${claseInput}`}
                      />
                    </label>
                    <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Plazo (días)
                      <input
                        name="leadTimeDays"
                        required
                        inputMode="numeric"
                        className={`tabular ${claseInput}`}
                      />
                    </label>
                    <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                      Notas
                      <input name="notes" className={claseInput} />
                    </label>
                    <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                      <Icon name="send" size={14} />
                      Registrar
                    </BotonEnvio>
                  </form>
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}
