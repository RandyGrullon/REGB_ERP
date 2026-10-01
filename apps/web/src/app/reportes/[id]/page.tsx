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

/**
 * El gráfico que el reporte dice tener. Antes decía "Gráfico: Barras" y
 * enseñaba solo la tabla. Barras horizontales o una línea, sobre la
 * primera columna numérica; sin librería, con los colores del sistema.
 */
function Grafico({
  tipo,
  filas,
  etiqueta,
  valor,
}: {
  tipo: string
  filas: { etiqueta: string; valor: number }[]
  etiqueta: string
  valor: string
}) {
  const max = Math.max(...filas.map((f) => f.valor), 0)
  if (max <= 0) return null
  if (tipo === 'line' && filas.length > 1) {
    const ancho = 600
    const alto = 160
    const puntos = filas
      .map((f, i) => {
        const x = (i / (filas.length - 1)) * ancho
        const y = alto - (f.valor / max) * (alto - 8) - 4
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
    return (
      <figure className="space-y-2">
        <svg
          viewBox={`0 0 ${ancho} ${alto}`}
          className="h-40 w-full"
          role="img"
          aria-label={`${valor} por ${etiqueta.toLowerCase()}`}
          preserveAspectRatio="none"
        >
          <polyline
            points={puntos}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <figcaption className="flex justify-between text-xs text-[var(--color-text-muted)]">
          <span>{filas[0]!.etiqueta}</span>
          <span>{filas[filas.length - 1]!.etiqueta}</span>
        </figcaption>
      </figure>
    )
  }
  return (
    <ul className="space-y-2" aria-label={`${valor} por ${etiqueta.toLowerCase()}`}>
      {filas.map((f) => (
        <li
          key={f.etiqueta}
          className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3"
        >
          <span className="truncate text-sm text-[var(--color-text-primary)]">{f.etiqueta}</span>
          <span className="h-3 overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
            <span
              className="block h-full rounded-full bg-[var(--color-brand)]"
              style={{ width: `${Math.max((f.valor / max) * 100, 2)}%` }}
            />
          </span>
          <span className="tabular text-sm font-semibold text-[var(--color-text-primary)]">
            {num(f.valor)}
          </span>
        </li>
      ))}
    </ul>
  )
}

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
  const colEtiqueta = resultado.columnas.find((c) => !c.numeric)
  const colValor = resultado.columnas.find((c) => c.numeric)
  const conGrafico =
    head.chart_type !== 'table' && colEtiqueta && colValor && resultado.filas.length > 0

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
          Gráfico: {TIPO_GRAFICO[head.chart_type] ?? head.chart_type} · Datos al{' '}
          {new Date().toLocaleString('es-DO', {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'America/Santo_Domingo',
          })}
        </p>

        {conGrafico && (
          <Card>
            <CardHeader>
              <CardTitle>Gráfico</CardTitle>
            </CardHeader>
            <CardBody>
              <Grafico
                tipo={head.chart_type}
                etiqueta={colEtiqueta.label}
                valor={colValor.label}
                filas={resultado.filas.map((f) => ({
                  etiqueta: String(f[colEtiqueta.key]),
                  valor: Number(f[colValor.key]),
                }))}
              />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
          </CardHeader>
          <CardBody>
            {resultado.filas.length === 0 ? (
              <EmptyState
                icon="bar_chart"
                title="Sin datos todavía"
                description="Esta fuente no tiene nada que mostrar por ahora. Cuando haya movimiento en el módulo del que sale, aparece aquí solo."
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
