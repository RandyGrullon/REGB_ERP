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
import { nivelPorPuntosDeVida } from '@regb/operations'
import { asUser } from '@/lib/db'
import { modulePage, exigir, type DemoParams } from '@/lib/module-page'
import { Shell } from '@/components/Shell'
import { registrarPuntosForm } from './actions'
import { NIVEL_FIDELIDAD } from './estados'
import { BotonEnvio } from '@/components/BotonEnvio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fidelizacion · REGB ERP' }

interface ClienteFila {
  id: string
  name: string
  saldo: number
  vida: number
}

const badgeNivel = (n: string): 'success' | 'warning' | 'neutral' => {
  if (n === 'oro') return 'success'
  if (n === 'plata') return 'warning'
  return 'neutral'
}

/** Fidelizacion (modulo 38): el saldo se deriva del historial, el nivel de los puntos ganados de por vida. */
export default async function FidelizacionPage({
  searchParams,
}: {
  searchParams: Promise<DemoParams>
}) {
  const params = await searchParams
  const { ctx, shell } = await modulePage(params, 'loyalty')

  const { clientes, cuponesActivos, referidosPendientes } = await asUser(ctx.userId, ctx.tenantId, async (tx) => {
    const c = await tx<{ id: string; name: string; saldo: string; vida: string }[]>`
      select c.id, c.name,
             public.loyalty_balance(c.id)::text as saldo,
             public.loyalty_lifetime_points(c.id)::text as vida
      from public.customers c
      where c.tenant_id = ${ctx.tenantId}
      order by public.loyalty_lifetime_points(c.id) desc, c.name
      limit 100`
    const [cup] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.loyalty_coupons where tenant_id = ${ctx.tenantId} and status = 'active'`
    const [ref] = await tx<{ n: string }[]>`
      select count(*)::text as n from public.loyalty_referrals where tenant_id = ${ctx.tenantId} and status = 'pending'`
    return {
      clientes: c.map((r) => ({ id: r.id, name: r.name, saldo: Number(r.saldo), vida: Number(r.vida) })) as ClienteFila[],
      cuponesActivos: Number(cup?.n ?? 0),
      referidosPendientes: Number(ref?.n ?? 0),
    }
  })

  const puedeGestionar = exigir(ctx, 'loyalty', 'loyalty.manage').ok
  const qs = ctx.demoQs
  const conPuntos = clientes.filter((c) => c.vida > 0)

  return (
    <Shell {...shell} activePath="/fidelizacion">
      <div className="space-y-5">
        <PageHeader
          icon="redeem"
          title="Fidelizacion"
          description="El nivel se gana con puntos de por vida -redimir un premio nunca baja de nivel a nadie-."
          actions={
            <a
              href={`/fidelizacion/cupones${qs}`}
              className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-raised)]"
            >
              <Icon name="confirmation_number" size={14} />
              Cupones
            </a>
          }
        />

        <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Clientes con puntos" value={String(conPuntos.length)} />
          <StatCard label="Cupones activos" value={String(cuponesActivos)} />
          <StatCard label="Referidos pendientes" value={String(referidosPendientes)} />
        </section>

        {clientes.length === 0 ? (
          <EmptyState icon="redeem" title="Todavia no hay clientes" description="Registra puntos abajo para empezar." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH numeric>Saldo</TH>
                <TH numeric>Puntos de por vida</TH>
                <TH>Nivel</TH>
              </TR>
            </THead>
            <TBody>
              {clientes.map((c) => {
                const nivel = nivelPorPuntosDeVida(c.vida)
                return (
                  <TR key={c.id}>
                    <TD className="text-[var(--color-text-primary)]">
                      <a href={`/fidelizacion/${c.id}${qs}`} className="underline-offset-2 hover:underline">
                        {c.name}
                      </a>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{c.saldo}</span>
                    </TD>
                    <TD numeric>
                      <span className="tabular">{c.vida}</span>
                    </TD>
                    <TD>
                      <Badge tone={badgeNivel(nivel)}>{NIVEL_FIDELIDAD[nivel]}</Badge>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}

        {puedeGestionar && (
          <Card>
            <CardHeader>
              <CardTitle>Registrar puntos manualmente</CardTitle>
            </CardHeader>
            <CardBody>
              <form action={registrarPuntosForm} className="flex flex-wrap items-end gap-3">
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
                <label className="flex w-32 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Puntos (+/-)
                  <input
                    name="points"
                    required
                    inputMode="numeric"
                    placeholder="100 o -50"
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)] tabular"
                  />
                </label>
                <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-[var(--color-text-muted)]">
                  Razon
                  <input
                    name="reason"
                    required
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-input)] px-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>
                <BotonEnvio
                  
                  className="flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3 text-xs font-medium text-[var(--color-text-on-brand)] hover:bg-[var(--color-brand-hover)]">
                  <Icon name="add" size={14} />
                  Registrar
                </BotonEnvio>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
