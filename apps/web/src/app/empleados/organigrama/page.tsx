import { Card, CardBody, EmptyState, PageHeader } from '@regb/ui'
import { buildOrgChart, type OrgNode } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Organigrama · REGB ERP' }

interface EmpleadoLite {
  id: string
  name: string
  manager_id: string | null
  position: string
}

/** Nodo del arbol, con recursion visual -sangria por nivel, no un diagrama con lineas-. */
function Rama({ node, posiciones, nivel }: { node: OrgNode; posiciones: Map<string, string>; nivel: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2"
        style={{ marginLeft: nivel * 24 }}
      >
        <span className="font-medium text-[var(--color-text-primary)]">{node.name}</span>
        <span className="text-xs text-[var(--color-text-muted)]">{posiciones.get(node.id)}</span>
      </div>
      {node.reports.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.reports.map((r) => (
            <Rama key={r.id} node={r} posiciones={posiciones} nivel={nivel + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Organigrama (modulo 61): quien le reporta a quien, armado desde manager_id. */
export default async function OrganigramaPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'employees')

  const [empleados] = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const e = await tx<EmpleadoLite[]>`
      select id, first_name || ' ' || last_name as name, manager_id, position
      from public.employees
      where tenant_id = ${ctx.tenantId} and status = 'active'
      order by last_name`
    return [e] as const
  })

  const arbol = buildOrgChart(
    empleados.map((e) => ({ id: e.id, name: e.name, managerId: e.manager_id })),
  )
  const posiciones = new Map(empleados.map((e) => [e.id, e.position]))
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/empleados">
      <div className="space-y-5">
        <PageHeader
          icon="account_tree"
          title="Organigrama"
          description="Quien le reporta a quien, armado solo a partir del jefe directo de cada empleado."
          crumbs={[{ label: 'Empleados', href: `/empleados${qs}` }, { label: 'Organigrama' }]}
        />

        {arbol.length === 0 ? (
          <EmptyState
            icon="account_tree"
            title="Todavia no hay nada que dibujar"
            description="Registra empleados activos y asignales un jefe directo para ver el organigrama."
          />
        ) : (
          <Card>
            <CardBody>
              <ul className="space-y-2">
                {arbol.map((n) => (
                  <Rama key={n.id} node={n} posiciones={posiciones} nivel={0} />
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
