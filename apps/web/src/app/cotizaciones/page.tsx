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
import { pesos } from '@/lib/cantidad'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Cotizaciones · REGB ERP' }

interface RfqRow {
  id: string
  title: string
  deadline: string | null
  status: string
  cotizaciones: string
  invitados: string
  mejor_monto: string | null
  awarded_supplier_name: string | null
  created_at: string
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
             count(q.id)::text as cotizaciones,
             (select count(*) from public.rfq_invitations i where i.rfq_id = r.id)::text as invitados,
             min(q.total_amount)::text as mejor_monto,
             s.name as awarded_supplier_name, r.created_at::text
      from public.rfqs r
      left join public.rfq_quotes q on q.rfq_id = r.id
      left join public.suppliers s on s.id = r.awarded_supplier_id
      where r.tenant_id = ${ctx.tenantId}
      group by r.id, s.name
      order by r.created_at desc`,
  )

  const abiertos = rfqs.filter((r) => r.status === 'open').length
  const adjudicadas = rfqs.filter((r) => r.status === 'awarded').length
  // Fecha sin hora: se pinta en UTC para que no salga un día antes.
  const dia = (iso: string) =>
    new Date(iso).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
  const puedeGestionar = exigir(ctx, 'rfq', 'rfq.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/cotizaciones">
      <div className="space-y-5">
        <PageHeader
          icon="compare_arrows"
          title="Cotización a proveedores"
          description="Pídeles precio a varios proveedores por lo mismo y compara. Se adjudica siempre a la oferta más baja (si empatan, a la que entrega antes), no a criterio de quien compra."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Abiertas" value={String(abiertos)} hint="esperando precios" />
          <StatCard label="Adjudicadas" value={String(adjudicadas)} hint="ya tienen proveedor" />
          <StatCard label="Solicitudes" value={String(rfqs.length)} hint="todas" />
        </section>

        {rfqs.length === 0 ? (
          <EmptyState
            icon="compare_arrows"
            title="Todavía no has pedido ninguna cotización"
            description="Crea una solicitud abajo, invita a dos o tres proveedores y registra sus precios: el sistema te dice cuál es la mejor oferta."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Qué se cotiza</TH>
                <TH>Fecha límite</TH>
                <TH numeric>Precios recibidos</TH>
                <TH numeric>Mejor oferta</TH>
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
                  <TD className="whitespace-nowrap">
                    {r.deadline ? dia(r.deadline) : 'Sin fecha'}
                  </TD>
                  <TD numeric>
                    <span className="tabular">
                      {Number(r.invitados) > 0
                        ? `${r.cotizaciones} de ${r.invitados}`
                        : r.cotizaciones}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="tabular">{r.mejor_monto ? pesos(r.mejor_monto) : '—'}</span>
                  </TD>
                  <TD>
                    <Badge tone={badgeTono(r.status)}>{ESTADO_RFQ[r.status] ?? r.status}</Badge>
                    {r.awarded_supplier_name ? (
                      <span className="block pt-1 text-xs text-[var(--color-text-muted)]">
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
              <CardTitle>Nueva solicitud de cotización</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearRfqForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Qué se cotiza
                  <input
                    name="title"
                    required
                    placeholder="Cemento y varillas para el próximo mes"
                    className={claseInput}
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Descripción
                  <input name="description" className={claseInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha límite
                  <input type="date" name="deadline" className={claseInput} />
                </label>
                <BotonEnvio className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Crear solicitud
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
