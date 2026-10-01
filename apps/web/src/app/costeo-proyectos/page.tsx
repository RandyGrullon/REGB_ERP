import { Badge, EmptyState, PageHeader, StatCard, TBody, TD, TH, THead, TR, Table } from '@regb/ui'
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

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Con signo de verdad (−) pegado a "RD$", no suelto al principio de otra línea. */
const rd = (n: number) => `${n < 0 ? '−' : ''}RD$ ${money(Math.abs(n))}`

/** Costeo de proyectos (modulo 73): lo consumido y lo sin facturar se derivan, nunca se guardan. */
export default async function CosteoProyectosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'project-costing')

  const filas = await asUser(
    ctx.userId,
    ctx.tenantId,
    (tx) => tx<Fila[]>`
    select p.id, p.name, p.status,
           public.project_budget_total(p.id)::text as presupuesto,
           public.project_cost_total(p.id)::text as real,
           public.project_wip(p.id)::text as wip
    from public.projects p
    where p.tenant_id = ${ctx.tenantId}
    order by p.created_at desc`,
  )

  const qs = ctx.demoQs
  const totalPresupuesto = filas.reduce((a, f) => a + Number(f.presupuesto), 0)
  const totalReal = filas.reduce((a, f) => a + Number(f.real), 0)
  const totalWip = filas.reduce((a, f) => a + Number(f.wip), 0)
  const sobrePresupuesto = filas.filter(
    (f) => Number(f.real) > Number(f.presupuesto) && Number(f.presupuesto) > 0,
  ).length

  return (
    <Shell {...shell} activePath="/costeo-proyectos">
      <div className="space-y-5">
        <PageHeader
          icon="query_stats"
          title="Costeo de proyectos"
          description="Cuánto se ha gastado en cada proyecto contra lo presupuestado, cuánto queda y qué costo todavía no se le ha facturado al cliente."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Presupuestado" value={rd(totalPresupuesto)} />
          <StatCard
            label="Gastado"
            value={rd(totalReal)}
            hint={
              totalPresupuesto > 0
                ? `${Math.round((totalReal / totalPresupuesto) * 100)}% de lo presupuestado`
                : undefined
            }
          />
          <StatCard
            label="Costo sin facturar"
            value={rd(totalWip)}
            hint="gastado que todavía no se le cobra al cliente"
          />
          <StatCard
            label="Sobre presupuesto"
            value={String(sobrePresupuesto)}
            hint={sobrePresupuesto === 1 ? 'proyecto gastó de más' : 'proyectos gastaron de más'}
          />
        </section>

        {filas.length === 0 ? (
          <EmptyState
            icon="query_stats"
            title="Todavía no hay proyectos que costear"
            description="El costeo se lleva por proyecto. Crea uno en Proyectos y tareas y vuelve aquí para cargarle presupuesto y costos."
            action={
              <a
                href={`/proyectos${qs}`}
                className="flex h-10 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
              >
                Ir a Proyectos y tareas
              </a>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Proyecto</TH>
                <TH numeric>Presupuesto</TH>
                <TH numeric>Gastado</TH>
                <TH numeric>Consumido</TH>
                <TH numeric>Disponible</TH>
                <TH numeric>Sin facturar</TH>
              </TR>
            </THead>
            <TBody>
              {filas.map((f) => {
                const pres = Number(f.presupuesto)
                const real = Number(f.real)
                const disponible = pres - real
                const consumido = pres > 0 ? real / pres : null
                return (
                  <TR key={f.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <a
                        href={`/costeo-proyectos/${f.id}${qs}`}
                        className="font-semibold text-[var(--color-text-link)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {f.name}
                      </a>
                    </TD>
                    <TD numeric>
                      <span className="tabular whitespace-nowrap">{rd(pres)}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular whitespace-nowrap">{rd(real)}</span>
                    </TD>
                    <TD numeric>
                      {consumido === null ? (
                        <Badge tone="neutral">Sin presupuesto</Badge>
                      ) : (
                        <span
                          className={`tabular ${consumido > 1 ? 'font-semibold text-[var(--color-semantic-text-danger)]' : consumido >= 0.9 ? 'text-[var(--color-semantic-text-warning)]' : ''}`}
                        >
                          {Math.round(consumido * 100)}%
                        </span>
                      )}
                    </TD>
                    <TD numeric>
                      <span
                        className={`tabular whitespace-nowrap ${disponible < 0 ? 'font-semibold text-[var(--color-semantic-text-danger)]' : ''}`}
                      >
                        {rd(disponible)}
                      </span>
                    </TD>
                    <TD numeric>
                      <span className="tabular whitespace-nowrap">{rd(Number(f.wip))}</span>
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
