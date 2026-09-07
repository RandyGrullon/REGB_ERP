import { notFound } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
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
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'

interface CentroHead {
  id: string
  code: string
  name: string
  is_active: boolean
}

interface AsignacionRow {
  id: string
  allocation_date: string
  amount: string
  description: string
  source_type: string
  created_by_name: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ORIGEN_LABEL: Record<string, string> = {
  manual: 'Manual',
  journal_entry: 'Desde un asiento',
}

/** Ficha de un centro de costo: su historial completo de asignaciones. */
export default async function CentroCostoDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'cost-centers')

  const [head, asignaciones] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<CentroHead[]>`
      select id, code, name, is_active from public.cost_centers
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return [null, []] as const

    const a = await tx<AsignacionRow[]>`
      select a.id, a.allocation_date::text, a.amount::text, a.description, a.source_type,
             up.display_name as created_by_name
      from public.cost_center_allocations a
      left join public.user_profiles up
        on up.tenant_id = a.tenant_id and up.user_id = a.created_by
      where a.cost_center_id = ${id} and a.tenant_id = ${ctx.tenantId}
      order by a.allocation_date desc, a.created_at desc
      limit 200`

    return [h, a] as const
  })

  if (!head) notFound()

  const total = asignaciones.reduce((a, x) => a + Number(x.amount), 0)
  const qs = ctx.demoQs

  const fecha = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-DO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <Shell {...shell} activePath="/centros-costo">
      <div className="space-y-5">
        <PageHeader
          icon="call_split"
          title={head.name}
          description={head.code}
          crumbs={[{ label: 'Centros de costo', href: `/centros-costo${qs}` }, { label: head.name }]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Total asignado" value={`RD$ ${money(total)}`} />
          <StatCard label="Asignaciones" value={String(asignaciones.length)} />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Historial de asignaciones</CardTitle>
          </CardHeader>
          <CardBody>
            {asignaciones.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--color-text-muted)]">
                Este centro todavia no tiene ninguna asignacion.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Fecha</TH>
                    <TH>Descripcion</TH>
                    <TH>Origen</TH>
                    <TH>Registrado por</TH>
                    <TH numeric>Monto</TH>
                  </TR>
                </THead>
                <TBody>
                  {asignaciones.map((a) => (
                    <TR key={a.id}>
                      <TD>{fecha(a.allocation_date)}</TD>
                      <TD className="text-[var(--color-text-primary)]">{a.description}</TD>
                      <TD>{ORIGEN_LABEL[a.source_type] ?? a.source_type}</TD>
                      <TD>{a.created_by_name ?? '—'}</TD>
                      <TD numeric>
                        <span className="tabular">{money(Number(a.amount))}</span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
