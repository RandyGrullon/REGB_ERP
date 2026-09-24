import { notFound } from 'next/navigation'
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
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
import { ejecutarReporte, FUENTE_LABEL } from '../reportSources'
import { TIPO_GRAFICO } from '../estados'

export const dynamic = 'force-dynamic'

interface ReporteHead {
  id: string
  name: string
  source_key: string
  params: Record<string, unknown>
  chart_type: string
}

const num = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })

/** Detalle de un reporte (modulo 87): ejecuta su fuente fija y muestra el resultado tal cual. */
export default async function ReporteDetallePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'bi')

  const { head, resultado } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<ReporteHead[]>`
      select id, name, source_key, params, chart_type from public.report_definitions
      where id = ${id} and tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, resultado: null }
    const r = await ejecutarReporte(tx, ctx.tenantId, h.source_key, h.params)
    return { head: h, resultado: r }
  })

  if (!head || !resultado) notFound()

  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/reportes">
      <div className="space-y-5">
        <PageHeader
          icon="bar_chart"
          title={head.name}
          crumbs={[{ label: 'BI & Reportes', href: `/reportes${qs}` }, { label: head.name }]}
        />

        <p className="text-xs text-[var(--color-text-muted)]">
          Fuente: {FUENTE_LABEL[head.source_key as keyof typeof FUENTE_LABEL] ?? head.source_key} ·
          Grafico: {TIPO_GRAFICO[head.chart_type] ?? head.chart_type}
        </p>

        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
          </CardHeader>
          <CardBody>
            {resultado.filas.length === 0 ? (
              <EmptyState
                icon="bar_chart"
                title="Sin datos todavia"
                description="Esta fuente no tiene filas que mostrar por ahora."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    {resultado.columnas.map((c) => (
                      <TH key={c.key} numeric={!!c.numeric}>
                        {c.label}
                      </TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {resultado.filas.map((fila, i) => (
                    <TR key={i}>
                      {resultado.columnas.map((c) =>
                        c.numeric ? (
                          <TD key={c.key} numeric>
                            <span className="tabular">{num(Number(fila[c.key]))}</span>
                          </TD>
                        ) : (
                          <TD key={c.key} className="text-[var(--color-text-primary)]">
                            {String(fila[c.key])}
                          </TD>
                        ),
                      )}
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
