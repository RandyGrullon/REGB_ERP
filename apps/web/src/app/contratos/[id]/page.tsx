import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import type { EstadoContrato } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { renovarContratoForm, transicionarContratoForm } from '../actions'
import { ESTADO_CONTRATO, FRECUENCIA_FACTURACION } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'

interface ContratoHead {
  id: string
  contract_number: string
  customer_name: string
  status: EstadoContrato
  billing_frequency: string
  start_date: string
  end_date: string
  base_amount: string
  escalation_pct: string
  auto_renew: boolean
  renewed_from_id: string | null
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-DO')
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]'
const botonSecundarioClase =
  'flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]'
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'active') return 'success'
  if (s === 'cancelled' || s === 'expired') return 'danger'
  if (s === 'draft') return 'warning'
  return 'neutral'
}

/** Detalle de un contrato (modulo 33): su maquina de estados y su renovacion. */
export default async function ContratoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'contracts')

  const head = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<ContratoHead[]>`
      select k.id, k.contract_number, c.name as customer_name, k.status, k.billing_frequency,
             k.start_date::text, k.end_date::text, k.base_amount::text, k.escalation_pct::text,
             k.auto_renew, k.renewed_from_id
      from public.contracts k
      join public.customers c on c.id = k.customer_id
      where k.id = ${id} and k.tenant_id = ${ctx.tenantId}`
    return h ?? null
  })

  if (!head) notFound()

  const puedeGestionar = exigir(ctx, 'contracts', 'contracts.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="contractId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/contratos">
      <div className="space-y-5">
        <PageHeader
          icon="assignment"
          title={head.contract_number}
          crumbs={[
            { label: 'Contratos', href: `/contratos${qs}` },
            { label: head.contract_number },
          ]}
          actions={
            <Badge tone={badgeEstado(head.status)}>
              {ESTADO_CONTRATO[head.status] ?? head.status}
            </Badge>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Cliente" value={head.customer_name} />
          <StatCard
            label="Frecuencia"
            value={FRECUENCIA_FACTURACION[head.billing_frequency] ?? head.billing_frequency}
          />
          <StatCard label="Monto" value={`RD$ ${money(Number(head.base_amount))}`} />
          <StatCard label="Vence" value={fecha(head.end_date)} />
        </section>

        <p className="text-xs text-[var(--color-text-muted)]">
          Vigente desde {fecha(head.start_date)} · Escalamiento{' '}
          {(Number(head.escalation_pct) * 100).toFixed(0)}% ·{' '}
          {head.auto_renew ? 'Renovacion automática' : 'Renovacion manual'}
        </p>

        {head.renewed_from_id && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Renueva a{' '}
            <a
              href={`/contratos/${head.renewed_from_id}${qs}`}
              className="text-[var(--color-text-link)] underline-offset-2 hover:underline"
            >
              el contrato anterior
            </a>
          </p>
        )}

        {puedeGestionar && (
          <div className="flex flex-wrap gap-2">
            {head.status === 'draft' && (
              <form action={transicionarContratoForm}>
                {campos}
                <input type="hidden" name="siguiente" value="active" />
                <BotonEnvio className={botonClase}>
                  <Icon name="check_circle" size={14} />
                  Activar
                </BotonEnvio>
              </form>
            )}
            {head.status === 'active' && (
              <>
                <form action={renovarContratoForm}>
                  {campos}
                  <BotonEnvio className={botonClase}>
                    <Icon name="autorenew" size={14} />
                    Renovar
                  </BotonEnvio>
                </form>
                <form action={transicionarContratoForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="cancelled" />
                  <BotonEnvio className={botonSecundarioClase}>Cancelar</BotonEnvio>
                </form>
                <form action={transicionarContratoForm}>
                  {campos}
                  <input type="hidden" name="siguiente" value="expired" />
                  <BotonEnvio className={botonSecundarioClase}>Marcar vencido</BotonEnvio>
                </form>
              </>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Lo que esto no hace</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              Renovar no edita este contrato: crea uno NUEVO con el escalamiento de precio aplicado,
              y este queda marcado "renovado" -su historial completo sigue intacto-.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
