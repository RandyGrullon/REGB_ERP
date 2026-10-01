import { notFound } from 'next/navigation'
import { Badge, Card, CardBody, CardHeader, CardTitle, Icon, PageHeader, StatCard } from '@regb/ui'
import { trabajoEnCurso } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { agregarPresupuestoForm, marcarFacturadoForm, registrarCostoForm } from '../actions'
import { CATEGORIA_PRESUPUESTO } from '../estados'
import { BotonEnvio } from '@/components/BotonEnvio'
import { fechaCorta } from '@/lib/fechas-rd'

export const dynamic = 'force-dynamic'

interface Head {
  id: string
  name: string
  status: string
  presupuesto: string
  real: string
  facturado: string
}

interface LineaPresupuesto {
  id: string
  concept: string
  category: string
  amount: string
}

interface Costo {
  id: string
  concept: string
  amount: string
  incurred_on: string
  billed: boolean
  budget_id: string | null
  budget_concept: string | null
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Con signo de verdad (−) pegado a "RD$", no suelto al principio de otra línea. */
const rd = (n: number) => `${n < 0 ? '−' : ''}RD$ ${money(Math.abs(n))}`
const botonClase =
  'flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-4 text-xs font-semibold text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]'
const inputClase =
  'h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]'

/** Costeo de un proyecto (modulo 73): presupuesto contra real, con cada costo como hecho histórico. */
export default async function CosteoProyectoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<DemoParams>
}) {
  const { id } = await params
  const sp = await searchParams
  const { ctx, shell } = await modulePage(sp, 'project-costing')

  const { head, presupuesto, costos } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const [h] = await tx<Head[]>`
      select p.id, p.name, p.status,
             public.project_budget_total(p.id)::text as presupuesto,
             public.project_cost_total(p.id)::text as real,
             (public.project_cost_total(p.id) - public.project_wip(p.id))::text as facturado
      from public.projects p
      where p.id = ${id} and p.tenant_id = ${ctx.tenantId}`
    if (!h) return { head: null, presupuesto: [], costos: [] }

    const b = await tx<LineaPresupuesto[]>`
      select id, concept, category, amount::text from public.project_budgets
      where tenant_id = ${ctx.tenantId} and project_id = ${id} order by created_at`

    const c = await tx<Costo[]>`
      select pc.id, pc.concept, pc.amount::text, pc.incurred_on::text, pc.billed,
             pc.budget_id, pb.concept as budget_concept
      from public.project_costs pc
      left join public.project_budgets pb on pb.id = pc.budget_id
      where pc.tenant_id = ${ctx.tenantId} and pc.project_id = ${id}
      order by pc.incurred_on desc, pc.created_at desc`

    return { head: h, presupuesto: b, costos: c }
  })

  if (!head) notFound()

  const pres = Number(head.presupuesto)
  const real = Number(head.real)
  const facturado = Number(head.facturado)
  const disponible = pres - real
  const consumido = pres > 0 ? Math.round((real / pres) * 100) : null
  const wip = trabajoEnCurso(real, facturado)
  // Lo gastado contra cada línea: para ver cuál se pasó, no solo el total.
  const gastadoPorLinea = new Map<string, number>()
  for (const c of costos) {
    if (c.budget_id)
      gastadoPorLinea.set(c.budget_id, (gastadoPorLinea.get(c.budget_id) ?? 0) + Number(c.amount))
  }

  const puedeGestionar = exigir(ctx, 'project-costing', 'project-costing.manage').ok
  const qs = ctx.demoQs
  const campos = (
    <>
      <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
      <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
      <input type="hidden" name="projectId" value={head.id} />
    </>
  )

  return (
    <Shell {...shell} activePath="/costeo-proyectos">
      <div className="space-y-5">
        <PageHeader
          icon="query_stats"
          title={head.name}
          crumbs={[
            { label: 'Costeo de proyectos', href: `/costeo-proyectos${qs}` },
            { label: head.name },
          ]}
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Presupuesto" value={rd(pres)} />
          <StatCard
            label="Gastado"
            value={rd(real)}
            hint={
              consumido === null
                ? 'sin presupuesto contra qué comparar'
                : `${consumido}% del presupuesto`
            }
          />
          <StatCard
            label={disponible < 0 ? 'Gastado de más' : 'Disponible'}
            value={rd(Math.abs(disponible))}
            hint={disponible < 0 ? 'por encima del presupuesto' : 'queda por gastar'}
          />
          <StatCard
            label="Costo sin facturar"
            value={rd(wip)}
            hint="gastado que todavía no se le cobra al cliente"
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Presupuesto</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-[var(--color-border)]">
              {presupuesto.length === 0 && (
                <li className="py-2 text-xs text-[var(--color-text-muted)]">
                  Todavía no hay líneas de presupuesto.
                </li>
              )}
              {presupuesto.map((l) => {
                const monto = Number(l.amount)
                const gastado = gastadoPorLinea.get(l.id) ?? 0
                const excedido = gastado > monto
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--color-text-primary)]">{l.concept}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {CATEGORIA_PRESUPUESTO[l.category] ?? l.category} · gastado {rd(gastado)}
                        {monto > 0 ? ` (${Math.round((gastado / monto) * 100)}%)` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {excedido && <Badge tone="danger">Excedida</Badge>}
                      <span className="tabular whitespace-nowrap text-sm text-[var(--color-text-primary)]">
                        {rd(monto)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>

            {puedeGestionar && (
              <form action={agregarPresupuestoForm} className="mt-4 flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Concepto
                  <input name="concept" required className={inputClase} />
                </label>
                <label className="flex w-40 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Categoría
                  <select name="category" defaultValue="general" className={inputClase}>
                    {Object.entries(CATEGORIA_PRESUPUESTO).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto (RD$)
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    className={`${inputClase} tabular`}
                  />
                </label>
                <BotonEnvio className={botonClase}>
                  <Icon name="add" size={14} />
                  Agregar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Costos reales</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-[var(--color-border)]">
              {costos.length === 0 && (
                <li className="py-2 text-xs text-[var(--color-text-muted)]">
                  Todavía no hay costos registrados.
                </li>
              )}
              {costos.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm text-[var(--color-text-primary)]">{c.concept}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {fechaCorta(c.incurred_on, true)}
                      {c.budget_concept
                        ? ` · contra «${c.budget_concept}»`
                        : ' · sin línea de presupuesto'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular whitespace-nowrap text-sm text-[var(--color-text-primary)]">
                      {rd(Number(c.amount))}
                    </span>
                    {c.billed ? (
                      <Badge tone="success">Facturado</Badge>
                    ) : puedeGestionar ? (
                      <form action={marcarFacturadoForm}>
                        {campos}
                        <input type="hidden" name="costId" value={c.id} />
                        <BotonEnvio
                          title="Marca este costo como ya facturado al cliente"
                          className="flex h-8 items-center rounded-full border border-[var(--color-border)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
                        >
                          Marcar facturado
                        </BotonEnvio>
                      </form>
                    ) : (
                      <Badge tone="warning">Sin facturar</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {puedeGestionar && (
              <form action={registrarCostoForm} className="mt-4 flex flex-wrap items-end gap-3">
                {campos}
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Concepto
                  <input name="concept" required className={inputClase} />
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Contra presupuesto (opcional)
                  <select name="budgetId" className={inputClase}>
                    <option value="">Sin línea</option>
                    {presupuesto.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.concept}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto (RD$)
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    className={`${inputClase} tabular`}
                  />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fecha
                  <input type="date" name="incurredOn" className={inputClase} />
                </label>
                <BotonEnvio className={botonClase}>
                  <Icon name="add" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por qué un costo no se edita</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-[var(--color-text-muted)]">
              Un costo registrado no cambia de monto: es algo que ya pasó y queda en el historial.
              Lo único que se marca después es si ya se le facturó al cliente.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
