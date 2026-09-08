import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Icon,
  Mono,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@regb/ui'
import { contratoVigente } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { crearContratoForm } from './actions'
import { ESTADO_CONTRATO } from './estados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contratos · REGB ERP' }

interface ContratoRow {
  id: string
  contract_number: string
  customer_name: string
  status: string
  end_date: string
  base_amount: string
}

interface ClienteOption {
  id: string
  name: string
}

const money = (n: number) => n.toLocaleString('es-DO', { minimumFractionDigits: 2 })
const badgeEstado = (s: string): 'success' | 'danger' | 'warning' | 'neutral' => {
  if (s === 'active') return 'success'
  if (s === 'cancelled' || s === 'expired') return 'danger'
  if (s === 'draft') return 'warning'
  return 'neutral'
}

/** Contratos & Suscripciones (modulo 33): renovar crea uno nuevo, nunca sobrescribe. */
export default async function ContratosPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'contracts')

  const { contratos, clientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<ContratoRow[]>`
      select k.id, k.contract_number, c.name as customer_name, k.status, k.end_date::text, k.base_amount::text
      from public.contracts k
      join public.customers c on c.id = k.customer_id
      where k.tenant_id = ${ctx.tenantId} and k.status != 'renewed'
      order by k.created_at desc`
    const cl = await tx<ClienteOption[]>`
      select id, name from public.customers where tenant_id = ${ctx.tenantId} order by name limit 300`
    return { contratos: c, clientes: cl }
  })

  const vencenPronto = contratos.filter(
    (c) => c.status === 'active' && !contratoVigente(new Date(c.end_date), new Date(Date.now() + 30 * 86_400_000)),
  ).length
  const puedeGestionar = exigir(ctx, 'contracts', 'contracts.manage').ok
  const qs = ctx.demoQs

  return (
    <Shell {...shell} activePath="/contratos">
      <div className="space-y-5">
        <PageHeader
          icon="assignment"
          title="Contratos & Suscripciones"
          description="Renovar crea un contrato nuevo -con el escalamiento de precio aplicado-, nunca sobrescribe el anterior."
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Contratos" value={String(contratos.length)} />
          <StatCard label="Vencen en 30 dias" value={String(vencenPronto)} />
        </section>

        {contratos.length === 0 ? (
          <EmptyState icon="assignment" title="Todavia no hay ningun contrato" description="Crea el primero abajo." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Contrato</TH>
                <TH>Cliente</TH>
                <TH numeric>Monto</TH>
                <TH>Vence</TH>
                <TH>Estado</TH>
              </TR>
            </THead>
            <TBody>
              {contratos.map((c) => (
                <TR key={c.id}>
                  <TD className="text-[var(--color-text-primary)]">
                    <a href={`/contratos/${c.id}${qs}`} className="underline-offset-2 hover:underline">
                      <Mono>{c.contract_number}</Mono>
                    </a>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">{c.customer_name}</TD>
                  <TD numeric>
                    <span className="tabular">RD$ {money(Number(c.base_amount))}</span>
                  </TD>
                  <TD className="text-[var(--color-text-muted)]">
                    {new Date(c.end_date).toLocaleDateString('es-DO')}
                  </TD>
                  <TD>
                    <Badge tone={badgeEstado(c.status)}>{ESTADO_CONTRATO[c.status] ?? c.status}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Nuevo contrato</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={crearContratoForm} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="tenant" value={qs ? ctx.tenantSlug : ''} />
                <input type="hidden" name="rol" value={qs ? ctx.roleName : ''} />
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Cliente
                  <select
                    name="customerId"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Frecuencia
                  <select
                    name="billingFrequency"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="monthly">Mensual</option>
                    <option value="quarterly">Trimestral</option>
                    <option value="annual">Anual</option>
                  </select>
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Inicio
                  <input type="date" name="startDate" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-36 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Fin
                  <input type="date" name="endDate" required className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]" />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Monto (RD$)
                  <input name="baseAmount" required inputMode="decimal" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular" />
                </label>
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Escalamiento %
                  <input name="escalationPct" placeholder="0.10 = 10%" inputMode="decimal" className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular" />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                  <input type="checkbox" name="autoRenew" />
                  Renovacion automatica
                </label>
                <button
                  type="submit"
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]"
                >
                  <Icon name="add" size={14} />
                  Crear
                </button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
