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
import { crearPresupuestoForm } from './actions'
import { ESTADO_PRESUPUESTO } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Presupuestos · REGB ERP' }

interface PresupuestoRow {
  id: string
  name: string
  fiscal_year: number
  status: string
  lineas: string
  total: string
}

const money = (n: number) =>
  n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Presupuestos (modulo 22): el plan por cuenta y por mes, cerrado cuando ya no cambia. */
export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'budgets')

  const [presupuestos] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const p = await tx<PresupuestoRow[]>`
      select b.id, b.name, b.fiscal_year, b.status,
             (select count(*) from public.budget_lines l where l.budget_id = b.id)::text as lineas,
             coalesce((select sum(l.amount) from public.budget_lines l where l.budget_id = b.id), 0)::text as total
      from public.budgets b
      where b.tenant_id = ${ctx.tenantId}
      order by b.fiscal_year desc, b.name
      limit 100`
    return [p] as const
  })

  const puedeCrear = exigir(ctx, 'budgets', 'budgets.budget.create').ok
  const qs = ctx.demoQs
  const anoActual = new Date().getFullYear()

  const claseInput =
    'h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-3 text-sm text-[var(--color-text-primary)]'

  return (
    <Shell {...shell} activePath="/presupuestos">
      <div className="space-y-5">
        <PageHeader
          icon="savings"
          title="Presupuestos"
          description="El plan de gasto e ingreso por cuenta y por mes, comparado contra lo que de verdad se contabilizo."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Presupuestos" value={String(presupuestos.length)} />
          <StatCard
            label="Activos"
            value={String(presupuestos.filter((p) => p.status === 'active').length)}
          />
          <StatCard
            label="Cerrados"
            value={String(presupuestos.filter((p) => p.status === 'closed').length)}
          />
        </section>

        {presupuestos.length === 0 ? (
          <EmptyState
            icon="savings"
            title="Todavia no hay ningun presupuesto"
            description="Crea el primero abajo con su ano fiscal, y desde su ficha pon el monto planeado por cuenta y por mes."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Presupuesto</TH>
                <TH>Ano</TH>
                <TH numeric>Lineas</TH>
                <TH numeric>Total planeado</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {presupuestos.map((p) => {
                const e = ESTADO_PRESUPUESTO[p.status] ?? { label: p.status, tone: 'neutral' as const }
                return (
                  <TR key={p.id}>
                    <TD>
                      <a
                        href={`/presupuestos/${p.id}${qs}`}
                        className="font-medium text-[var(--color-text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]"
                      >
                        {p.name}
                      </a>
                    </TD>
                    <TD>{p.fiscal_year}</TD>
                    <TD numeric>
                      <span className="tabular">{p.lineas}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular font-semibold">{money(Number(p.total))}</span>
                    </TD>
                    <TD>
                      <Badge tone={e.tone}>{e.label}</Badge>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeCrear && (
          <Card>
            <CardHeader>
              <CardTitle>Crear presupuesto</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearPresupuestoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Nombre
                  <input name="name" required placeholder="Presupuesto anual" className={claseInput} />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Ano fiscal
                  <input
                    name="fiscalYear"
                    required
                    inputMode="numeric"
                    defaultValue={String(anoActual)}
                    className={`tabular ${claseInput}`}
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-text-on-brand)] transition-colors hover:bg-[var(--color-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-bright)]">
                  <Icon name="add" size={18} />
                  Crear
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
