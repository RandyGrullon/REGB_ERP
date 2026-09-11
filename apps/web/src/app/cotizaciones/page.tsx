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
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearRfqForm } from './actions'
import { ESTADO_RFQ } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cotizaciones · REGB ERP' }

interface RfqRow {
  id: string
  title: string
  deadline: string | null
  status: string
  cotizaciones: string
  awarded_supplier_name: string | null
}

const claseInput =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

const badgeTono = (estado: string): 'success' | 'warning' | 'danger' => {
  if (estado === 'awarded') return 'success'
  if (estado === 'cancelled') return 'danger'
  return 'warning'
}

/** Cotizacion a proveedores / RFQ (modulo 44): comparativo automatico real. */
export default async function CotizacionesPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'rfq')

  const rfqs = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<RfqRow[]>`
      select r.id, r.title, r.deadline::text, r.status,
             count(q.id)::text as cotizaciones, s.name as awarded_supplier_name
      from public.rfqs r
      left join public.rfq_quotes q on q.rfq_id = r.id
      left join public.suppliers s on s.id = r.awarded_supplier_id
      where r.tenant_id = ${ctx.tenantId}
      group by r.id, s.name
      order by r.created_at desc`,
  )

  const abiertos = rfqs.filter((r) => r.status === 'open').length
  const puedeGestionar = exigir(ctx, 'rfq', 'rfq.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/cotizaciones">
      <div className="space-y-5">
        <PageHeader
          icon="compare_arrows"
          title="Cotizacion a proveedores"
          description="El comparativo elige siempre el monto mas bajo -desempate por el plazo de entrega mas corto-, nunca a criterio de quien compra."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="RFQ abiertos" value={String(abiertos)} />
          <StatCard label="RFQ totales" value={String(rfqs.length)} />
        </section>

        {rfqs.length === 0 ? (
          <EmptyState icon="compare_arrows" title="Todavia no hay ningun RFQ" description="Crea el primero abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Titulo</TH>
                <TH>Fecha limite</TH>
                <TH numeric>Cotizaciones</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {rfqs.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <a
                      href={`/cotizaciones/${r.id}${qs}`}
                      className="text-[var(--color-text-primary)] underline-offset-2 hover:underline"
                    >
                      {r.title}
                    </a>
                  </TD>
                  <TD>{r.deadline ?? '—'}</TD>
                  <TD numeric>
                    <span className="tabular">{r.cotizaciones}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeTono(r.status)}>{ESTADO_RFQ[r.status] ?? r.status}</Badge>
                    {r.awarded_supplier_name ? (
                      <span className="ml-1 text-xs text-[var(--color-text-muted)]">
                        {r.awarded_supplier_name}
                      </span>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo RFQ</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearRfqForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Titulo
                  <input name="title" required className={claseInput} />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripcion
                  <input name="description" className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha limite
                  <input type="date" name="deadline" className={claseInput} />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear RFQ
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
