import { Badge, EmptyState, PageHeader, StatCard, TBody, TD, TH, THead, TR, Table } from '@regb/ui'
import { desviacion, margen } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Costeo de proyectos · REGB ERP' }

interface Fila {
  id: string
  name: string
  status: string
  presupuesto: string
  real: string
  wip: string
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)

/** Costeo de proyectos (modulo 73): el margen y el WIP se derivan, nunca se guardan. */
export default async function CosteoProyectosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'project-costing')

  const filas = await asUser(ctx.userId, ctx.tenantId, (tx) => tx<Fila[]>`
    select p.id, p.name, p.status,
           public.project_budget_total(p.id)::text as presupuesto,
           public.project_cost_total(p.id)::text as real,
           public.project_wip(p.id)::text as wip
    from public.projects p
    where p.tenant_id = ${ctx.tenantId}
    order by p.created_at desc`)

  const qs = ctx.demoQs
  const totalPresupuesto = filas.reduce((a, f) => a + Number(f.presupuesto), 0)
  const totalReal = filas.reduce((a, f) => a + Number(f.real), 0)
  const totalWip = filas.reduce((a, f) => a + Number(f.wip), 0)
  const sobrePresupuesto = filas.filter((f) => Number(f.real) > Number(f.presupuesto) && Number(f.presupuesto) > 0).length

  return (
    <Shell {...shell} activePath="/costeo-proyectos">
      <div className="space-y-5">
        <PageHeader
          icon="query_stats"
          title="Costeo de proyectos"
          description="El margen, la desviacion y el WIP se derivan del historial -nunca se guardan como un numero que pueda desincronizarse-."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Presupuestado" value={`RD$ ${money(totalPresupuesto)}`} />
          <StatCard label="Gastado real" value={`RD$ ${money(totalReal)}`} />
          <StatCard label="WIP sin facturar" value={`RD$ ${money(totalWip)}`} />
          <StatCard label="Sobre presupuesto" value={String(sobrePresupuesto)} />
        </section>

        {filas.length === 0 ? (
          <EmptyState
            icon="query_stats"
            title="Todavia no hay proyectos que costear"
            description="Crea un proyecto en Proyectos & Tareas y vuelve aqui."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Proyecto</TH>
                <TH numeric>Presupuesto</TH>
                <TH numeric>Real</TH>
                <TH numeric>Desviacion</TH>
                <TH numeric>Margen</TH>
                <TH numeric>WIP</TH>
              </TR>
            </THead>
            <TBody>
              {filas.map((f) => {
                const pres = Number(f.presupuesto)
                const real = Number(f.real)
                const desv = desviacion(pres, real)
                const mrg = margen(pres, real)
                return (
                  <TR key={f.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <a href={`/costeo-proyectos/${f.id}${qs}`} className="underline-offset-2 hover:underline">
                        {f.name}
                      </a>
                    </TD>
                    <TD numeric>
                      <span className="tabular">RD$ {money(pres)}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">RD$ {money(real)}</span>
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular ${desv > 0 ? 'text-[var(--color-semantic-text-danger)]' : 'text-[var(--color-semantic-text-success)]'}`}
                      >
                        {desv > 0 ? '+' : ''}
                        {money(desv)}
                      </span>
                    </TD>
                    <TD numeric>
                      {mrg === null ? (
                        <Badge tone="neutral">Sin presupuesto</Badge>
                      ) : (
                        <span className={`tabular ${mrg < 0 ? 'text-[var(--color-semantic-text-danger)]' : ''}`}>{pct(mrg)}</span>
                      )}
                    </TD>
                    <TD numeric>
                      <span className="tabular">RD$ {money(Number(f.wip))}</span>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>
    </Shell>
  )
}
